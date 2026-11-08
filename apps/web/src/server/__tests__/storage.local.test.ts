import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { LocalDiskStorage } from "@/server/storage";
import { TEST_BYTES, testStream } from "./helpers";

let dir: string;
let storage: LocalDiskStorage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "oc-storage-"));
  storage = new LocalDiskStorage(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalDiskStorage (ADR-0004 dev provider)", () => {
  it("put + get round-trips bytes", async () => {
    await storage.put("jobs/j1/source.mp4", testStream(), {
      sizeBytes: TEST_BYTES.length,
      contentType: "video/mp4",
    });
    expect(await storage.get("jobs/j1/source.mp4")).toEqual(TEST_BYTES);
  });

  it("stream returns the object bytes", async () => {
    await storage.put("jobs/j2/source.mp4", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    const stream = await storage.stream("jobs/j2/source.mp4");
    expect(stream).not.toBeNull();
    const chunks: Uint8Array[] = [];
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      total.set(chunk, offset);
      offset += chunk.length;
    }
    expect(total).toEqual(TEST_BYTES);
  });

  it("stream returns null for missing objects", async () => {
    expect(await storage.stream("jobs/missing/source.mp4")).toBeNull();
  });

  it("head returns size without downloading and null when missing", async () => {
    await storage.put("jobs/head/source.mp4", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    expect(await storage.head("jobs/head/source.mp4")).toEqual({
      sizeBytes: TEST_BYTES.length,
      contentType: null,
    });
    expect(await storage.head("jobs/head/missing.mp4")).toBeNull();
  });

  it("move relocates an object (rename semantics)", async () => {
    await storage.put("incoming/tmp", testStream(), { sizeBytes: TEST_BYTES.length });
    await storage.move("incoming/tmp", "jobs/j3/source.mp4");
    expect(await storage.get("jobs/j3/source.mp4")).toEqual(TEST_BYTES);
    expect(await storage.get("incoming/tmp")).toBeNull();
  });

  it("move throws when the source does not exist", async () => {
    await expect(storage.move("incoming/nope", "jobs/j4/source.mp4")).rejects.toThrow();
  });

  it("delete and deleteMany remove objects", async () => {
    await storage.put("a/1.bin", testStream(), { sizeBytes: TEST_BYTES.length });
    await storage.put("b/2.bin", testStream(), { sizeBytes: TEST_BYTES.length });
    await storage.delete("a/1.bin");
    expect(await storage.get("a/1.bin")).toBeNull();
    await storage.deleteMany(["b/2.bin", "b/missing.bin"]);
    expect(await storage.get("b/2.bin")).toBeNull();
  });

  it("rejects and cleans up when the received size mismatches", async () => {
    await expect(
      storage.put("jobs/j5/source.mp4", testStream(), { sizeBytes: 9999 }),
    ).rejects.toThrow(/size mismatch/);
    expect(await storage.get("jobs/j5/source.mp4")).toBeNull();
  });

  it("refuses traversal keys", async () => {
    await expect(storage.get("../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(storage.put("..", testStream(), { sizeBytes: 2 })).rejects.toThrow(
      /Invalid storage key/,
    );
  });

  it("presign returns null (local media is served via the worker media route)", async () => {
    await storage.put("x.bin", testStream(), { sizeBytes: TEST_BYTES.length });
    expect(await storage.presign("x.bin")).toBeNull();
    expect(await storage.presignPut("x.bin", "application/octet-stream")).toBeNull();
  });

  it("writes real files under the root", async () => {
    await storage.put("jobs/j6/artifacts/audio/0.aac", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    const bytes = await readFile(path.join(dir, "jobs", "j6", "artifacts", "audio", "0.aac"));
    expect(new Uint8Array(bytes)).toEqual(TEST_BYTES);
  });
});
