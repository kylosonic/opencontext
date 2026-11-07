import { describe, expect, it, vi, beforeEach } from "vitest";

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
  return { commands, sendMock };
});

vi.mock("@aws-sdk/client-s3", () => {
  const make = (name: string) =>
    class {
      constructor(input: Record<string, unknown>) {
        state.commands.push({ name, input });
      }
    };
  class FakeS3Client {
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

import { S3Storage } from "@/server/storage";
import { TEST_BYTES, testStream } from "./helpers";

const config = {
  endpoint: "https://s3.example.com",
  region: "auto",
  bucket: "oc-media",
  accessKeyId: "key-id",
  secretAccessKey: "secret",
};

beforeEach(() => {
  state.commands.length = 0;
  state.sendMock.mockReset();
});

function lastCommand(name: string): Record<string, unknown> {
  const entry = state.commands.filter((c) => c.name === name).at(-1);
  if (!entry) {
    throw new Error(`No ${name} command was sent`);
  }
  return entry.input;
}

describe("S3Storage (mocked AWS SDK)", () => {
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
