import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

/**
 * S3 provider against mocked AWS SDK commands — asserts the exact
 * command wiring (bucket, key, content length, presigned URL) without
 * any network. The local provider is the verified dev path; this mock
 * pins the production-config-only contract.
 */

interface CommandRecord {
  name: string;
  input: Record<string, unknown>;
}

const state = vi.hoisted(() => {
  const commands: CommandRecord[] = [];
  const sendMock = vi.fn();
  const clientConfigs: Record<string, unknown>[] = [];
  return { commands, sendMock, clientConfigs };
});

vi.mock("@aws-sdk/client-s3", () => {
  const make = (name: string) =>
    class {
      constructor(input: Record<string, unknown>) {
        state.commands.push({ name, input });
      }
    };
  class FakeS3Client {
    constructor(config: Record<string, unknown>) {
      state.clientConfigs.push(config);
    }
    send = (command: unknown) => state.sendMock(command);
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: make("PutObjectCommand"),
    GetObjectCommand: make("GetObjectCommand"),
    CopyObjectCommand: make("CopyObjectCommand"),
    DeleteObjectCommand: make("DeleteObjectCommand"),
    DeleteObjectsCommand: make("DeleteObjectsCommand"),
    HeadObjectCommand: make("HeadObjectCommand"),
    CreateMultipartUploadCommand: make("CreateMultipartUploadCommand"),
    UploadPartCommand: make("UploadPartCommand"),
    CompleteMultipartUploadCommand: make("CompleteMultipartUploadCommand"),
    AbortMultipartUploadCommand: make("AbortMultipartUploadCommand"),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://signed.example/oc-media/key?token=abc"),
}));

const credentialsProviderMock = vi.hoisted(() => vi.fn(() => "oidc-provider"));
vi.mock("@vercel/oidc-aws-credentials-provider", () => ({
  awsCredentialsProvider: credentialsProviderMock,
}));

import { S3Storage } from "@/server/storage";
import { TEST_BYTES, testStream } from "./helpers";

const config = {
  endpoint: "https://s3.example.com",
  region: "auto",
  bucket: "oc-media",
  credentials: {
    kind: "static" as const,
    accessKeyId: "key-id",
    secretAccessKey: "secret",
  },
  forcePathStyle: true,
};

beforeEach(() => {
  state.commands.length = 0;
  state.clientConfigs.length = 0;
  state.sendMock.mockReset();
  credentialsProviderMock.mockClear();
});

function lastCommand(name: string): Record<string, unknown> {
  const entry = state.commands.filter((c) => c.name === name).at(-1);
  if (!entry) {
    throw new Error(`No ${name} command was sent`);
  }
  return entry.input;
}

describe("S3Storage (mocked AWS SDK)", () => {
  it("disables optional checksums so streaming artifact uploads work", () => {
    new S3Storage(config);

    expect(state.clientConfigs.at(-1)).toMatchObject({
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });

  it("uses Vercel OIDC credentials without a custom endpoint", () => {
    new S3Storage({
      region: "us-east-1",
      bucket: "aws-bucket",
      forcePathStyle: false,
      credentials: {
        kind: "vercel-oidc",
        roleArn: "arn:aws:iam::123456789012:role/OpenContext",
      },
    });

    expect(credentialsProviderMock).toHaveBeenCalledWith({
      roleArn: "arn:aws:iam::123456789012:role/OpenContext",
      clientConfig: { region: "us-east-1" },
    });
  });

  it("put sends PutObjectCommand with bucket, key, length and content type", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.put("jobs/j1/source.mp4", testStream(), {
      sizeBytes: TEST_BYTES.length,
      contentType: "video/mp4",
    });
    expect(state.sendMock).toHaveBeenCalledTimes(1);
    const input = lastCommand("PutObjectCommand");
    expect(input.Bucket).toBe("oc-media");
    expect(input.Key).toBe("jobs/j1/source.mp4");
    expect(input.ContentLength).toBe(TEST_BYTES.length);
    expect(input.ContentType).toBe("video/mp4");
    expect(input.Body).toBeInstanceOf(Readable);
  });

  it("get returns the object bytes", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => TEST_BYTES },
    });
    expect(await storage.get("k")).toEqual(TEST_BYTES);
    expect(lastCommand("GetObjectCommand").Key).toBe("k");
  });

  it("get returns null for a missing object (NoSuchKey)", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockRejectedValue({ name: "NoSuchKey" });
    expect(await storage.get("missing")).toBeNull();
  });

  it("head returns object metadata and null for a missing object", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValueOnce({ ContentLength: 42, ContentType: "video/mp4" });
    expect(await storage.head("jobs/j1/source.mp4")).toEqual({
      sizeBytes: 42,
      contentType: "video/mp4",
      etag: null,
    });
    state.sendMock.mockRejectedValueOnce({ name: "NotFound" });
    expect(await storage.head("missing")).toBeNull();
  });

  it("presign returns the signed URL", async () => {
    const storage = new S3Storage(config);
    expect(await storage.presign("jobs/j1/source.mp4", 900)).toBe(
      "https://signed.example/oc-media/key?token=abc",
    );
  });

  it("presignPut signs a PUT with the declared content type and length", async () => {
    const storage = new S3Storage(config);
    expect(await storage.presignPut("incoming/video.mp4", "video/mp4", 1234, 900)).toBe(
      "https://signed.example/oc-media/key?token=abc",
    );
    const input = lastCommand("PutObjectCommand");
    expect(input.Key).toBe("incoming/video.mp4");
    expect(input.ContentType).toBe("video/mp4");
    expect(input.ContentLength).toBe(1234);
  });

  it("move copies then deletes", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.move("incoming/x", "jobs/j1/source.mp4", { etag: '"abc"' });
    const copy = lastCommand("CopyObjectCommand");
    expect(copy.CopySource).toBe("oc-media/incoming/x");
    expect(copy.Key).toBe("jobs/j1/source.mp4");
    expect(copy.CopySourceIfMatch).toBe('"abc"');
    const del = lastCommand("DeleteObjectCommand");
    expect(del.Key).toBe("incoming/x");
  });

  it("copy copies without deleting the source object", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.copy("jobs/j1/source.mp4", "jobs/j2/source.mp4");
    expect(state.sendMock).toHaveBeenCalledTimes(1);
    const copy = lastCommand("CopyObjectCommand");
    expect(copy.Bucket).toBe("oc-media");
    expect(copy.CopySource).toBe("oc-media/jobs/j1/source.mp4");
    expect(copy.Key).toBe("jobs/j2/source.mp4");
  });

  it("deleteMany sends a multi-object delete with all keys", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.deleteMany(["a", "b"]);
    const input = lastCommand("DeleteObjectsCommand");
    expect(input.Delete).toEqual({ Objects: [{ Key: "a" }, { Key: "b" }], Quiet: true });
  });

  it("chunks large deletes below the S3 1,000-key limit", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.deleteMany(Array.from({ length: 1001 }, (_, index) => `key-${index}`));
    const deletes = state.commands.filter((command) => command.name === "DeleteObjectsCommand");
    expect(deletes).toHaveLength(2);
    expect((deletes[0].input.Delete as { Objects: unknown[] }).Objects).toHaveLength(1000);
    expect((deletes[1].input.Delete as { Objects: unknown[] }).Objects).toHaveLength(1);
  });

  it("streams the SDK web body and maps a missing key to null", async () => {
    const storage = new S3Storage(config);
    const body = new Blob(["streamed"]).stream();
    state.sendMock.mockResolvedValueOnce({ Body: { transformToWebStream: () => body } });
    expect(await storage.stream("jobs/j1/source.mp4")).toBe(body);

    state.sendMock.mockRejectedValueOnce({ name: "NoSuchKey" });
    expect(await storage.stream("missing")).toBeNull();
  });

  it("routes multipart init, uploadPart, complete, and abort to AWS SDK commands", async () => {
    const storage = new S3Storage(config);
    state.sendMock
      .mockResolvedValueOnce({ UploadId: "mp-1" })
      .mockResolvedValueOnce({ ETag: '"etag-1"' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const init = await storage.initMultipartUpload("incoming/big.mp4", "video/mp4");
    expect(init.uploadId).toBe("mp-1");
    expect(lastCommand("CreateMultipartUploadCommand")).toMatchObject({
      Bucket: "oc-media",
      Key: "incoming/big.mp4",
      ContentType: "video/mp4",
    });

    const part = await storage.uploadPart(
      "incoming/big.mp4",
      "mp-1",
      1,
      new Uint8Array([1, 2, 3]),
    );
    expect(part.etag).toBe('"etag-1"');
    expect(lastCommand("UploadPartCommand")).toMatchObject({
      Bucket: "oc-media",
      Key: "incoming/big.mp4",
      UploadId: "mp-1",
      PartNumber: 1,
      ContentLength: 3,
    });

    await storage.completeMultipartUpload("incoming/big.mp4", "mp-1", [
      { partNumber: 1, etag: '"etag-1"' },
    ]);
    expect(lastCommand("CompleteMultipartUploadCommand")).toMatchObject({
      Bucket: "oc-media",
      Key: "incoming/big.mp4",
      UploadId: "mp-1",
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"etag-1"' }] },
    });

    await storage.abortMultipartUpload("incoming/big.mp4", "mp-1");
    expect(lastCommand("AbortMultipartUploadCommand")).toMatchObject({
      Bucket: "oc-media",
      Key: "incoming/big.mp4",
      UploadId: "mp-1",
    });
  });
});
