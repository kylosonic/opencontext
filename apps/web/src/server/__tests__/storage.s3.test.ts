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

  it("presignPut signs a PUT with the declared content type", async () => {
    const storage = new S3Storage(config);
    expect(await storage.presignPut("incoming/video.mp4", "video/mp4", 900)).toBe(
      "https://signed.example/oc-media/key?token=abc",
    );
    const input = lastCommand("PutObjectCommand");
    expect(input.Key).toBe("incoming/video.mp4");
    expect(input.ContentType).toBe("video/mp4");
  });

  it("move copies then deletes", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.move("incoming/x", "jobs/j1/source.mp4");
    const copy = lastCommand("CopyObjectCommand");
    expect(copy.CopySource).toBe("oc-media/incoming/x");
    expect(copy.Key).toBe("jobs/j1/source.mp4");
    const del = lastCommand("DeleteObjectCommand");
    expect(del.Key).toBe("incoming/x");
  });

  it("deleteMany sends a multi-object delete with all keys", async () => {
    const storage = new S3Storage(config);
    state.sendMock.mockResolvedValue({});
    await storage.deleteMany(["a", "b"]);
    const input = lastCommand("DeleteObjectsCommand");
    expect(input.Delete).toEqual({ Objects: [{ Key: "a" }, { Key: "b" }] });
  });
});
