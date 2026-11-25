import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
    expect(await storage.head("jobs/head/source.mp4")).toMatchObject({
      sizeBytes: TEST_BYTES.length,
      contentType: null,
    });
    expect((await storage.head("jobs/head/source.mp4"))?.etag).toMatch(
      /^\d+-\d+(?:\.\d+)?$/,
    );
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

  it("move refuses an object changed after content validation", async () => {
    await storage.put("incoming/changing", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    const validatedEtag = (await storage.head("incoming/changing"))?.etag;
    expect(validatedEtag).toBeTruthy();
    await storage.put(
      "incoming/changing",
      new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])]).stream(),
      { sizeBytes: 9 },
    );

    await expect(
      storage.move("incoming/changing", "jobs/j4/changed.mp4", {
        etag: validatedEtag ?? undefined,
      }),
    ).rejects.toThrow(/changed after validation/);
    expect(await storage.get("incoming/changing")).toHaveLength(9);
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
    await expect(storage.get("jobs/..")).rejects.toThrow(/Invalid storage key/);
    await expect(
      storage.get("C:\\Windows\\system.ini"),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it("refuses symlinks that escape the storage root", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "oc-storage-outside-"));
    try {
      await symlink(outside, path.join(dir, "linked-directory"));
      await expect(
        storage.put("linked-directory/escape.bin", testStream(), {
          sizeBytes: TEST_BYTES.length,
        }),
      ).rejects.toThrow(/symlink/);
      await expect(storage.get("linked-directory/escape.bin")).rejects.toThrow(
        /symlink/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("presign returns null (local media is served via the worker media route)", async () => {
    await storage.put("x.bin", testStream(), { sizeBytes: TEST_BYTES.length });
    expect(await storage.presign("x.bin")).toBeNull();
    expect(
      await storage.presignPut("x.bin", "application/octet-stream", 1),
    ).toBeNull();
  });

  it("writes real files under the root", async () => {
    await storage.put("jobs/j6/artifacts/audio/0.aac", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    const bytes = await readFile(path.join(dir, "jobs", "j6", "artifacts", "audio", "0.aac"));
    expect(new Uint8Array(bytes)).toEqual(TEST_BYTES);
  });

  it("copy duplicates an object without removing the source and rejects missing source", async () => {
    await storage.put("jobs/j7/source.mp4", testStream(), {
      sizeBytes: TEST_BYTES.length,
    });
    await storage.copy("jobs/j7/source.mp4", "jobs/j8/source.mp4");
    expect(await storage.get("jobs/j7/source.mp4")).toEqual(TEST_BYTES);
    expect(await storage.get("jobs/j8/source.mp4")).toEqual(TEST_BYTES);
    await expect(
      storage.copy("jobs/missing/source.mp4", "jobs/j8/other.mp4"),
    ).rejects.toThrow(/does not exist/);
  });

  it("supports resumable multipart upload init, out-of-order parts, complete, and abort", async () => {
    const { uploadId } = await storage.initMultipartUpload(
      "incoming/multi.mp4",
      "video/mp4",
    );
    const part2 = await storage.uploadPart(
      "incoming/multi.mp4",
      uploadId,
      2,
      new Uint8Array([4, 5, 6]),
    );
    const part1 = await storage.uploadPart(
      "incoming/multi.mp4",
      uploadId,
      1,
      new Uint8Array([1, 2, 3]),
    );
    await storage.completeMultipartUpload("incoming/multi.mp4", uploadId, [
      { partNumber: 2, etag: part2.etag },
      { partNumber: 1, etag: part1.etag },
    ]);
    expect(await storage.get("incoming/multi.mp4")).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );

    const aborted = await storage.initMultipartUpload(
      "incoming/aborted.mp4",
      "video/mp4",
    );
    await storage.uploadPart(
      "incoming/aborted.mp4",
      aborted.uploadId,
      1,
      new Uint8Array([9, 9]),
    );
    await storage.abortMultipartUpload("incoming/aborted.mp4", aborted.uploadId);
    expect(await storage.get("incoming/aborted.mp4")).toBeNull();
  });
});
