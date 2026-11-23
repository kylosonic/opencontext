import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getStorage, storage } from "@/server/storage";
import { createJob, jobToDetail } from "@/server/jobs";
import { createQueuedJob, createUser, resetDatabase, resetStorage, TEST_BYTES } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

describe("createJob (upload commit sequence, blueprint §3 B3)", () => {
  it("creates Job + SOURCE Media and moves temp → final key atomically", async () => {
    const user = await createUser();
    const tempKey = "incoming/test-uuid";
    await storage.put(tempKey, new Blob([TEST_BYTES]).stream(), {
      sizeBytes: TEST_BYTES.length,
    });

    const job = await createJob({
      userId: user.id,
      displayName: "banking demo (final).mp4",
      detailLevel: "MEDIUM",
      sourceExt: "mp4",
      sourceSize: TEST_BYTES.length,
      sourceMime: "video/mp4",
      tempKey,
    });

    expect(job.status).toBe("QUEUED");
    expect(job.detailLevel).toBe("MEDIUM");
    expect(job.sourceKey).toBe(`jobs/${job.id}/source.mp4`);
    expect(job.sourceExt).toBe("mp4");
    expect(job.sourceSize).toBe(TEST_BYTES.length);

    const stageStates = job.stageStates as { stage: string; status: string }[];
    expect(stageStates).toHaveLength(5);
    for (const state of stageStates) {
      expect(state.status).toBe("NOT_STARTED");
    }

    const media = await prisma.media.findFirst({
      where: { jobId: job.id, kind: "SOURCE" },
    });
    expect(media).not.toBeNull();
    expect(media?.key).toBe(job.sourceKey);
    expect(media?.sizeBytes).toBe(TEST_BYTES.length);

    const moved = await storage.get(job.sourceKey as string);
    expect(moved).toEqual(TEST_BYTES);
    await expect(storage.get(tempKey)).resolves.toBeNull();
  });

  it("does not expose a queued job while its source move is in flight", async () => {
    const user = await createUser();
    const tempKey = "incoming/slow-move";
    await storage.put(tempKey, new Blob([TEST_BYTES]).stream(), {
      sizeBytes: TEST_BYTES.length,
    });

    let releaseMove: () => void = () => undefined;
    let markMoveStarted: () => void = () => undefined;
    const moveStarted = new Promise<void>((resolve) => {
      markMoveStarted = resolve;
    });
    const moveGate = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const storageBackend = getStorage();
    const originalMove = storageBackend.move.bind(storageBackend);
    const moveSpy = vi.spyOn(storageBackend, "move").mockImplementation(
      async (fromKey, toKey, options) => {
        markMoveStarted();
        await moveGate;
        await originalMove(fromKey, toKey, options);
      },
    );

    try {
      const pending = createJob({
        userId: user.id,
        displayName: "slow.mp4",
        detailLevel: "MEDIUM",
        sourceExt: "mp4",
        sourceSize: TEST_BYTES.length,
        sourceMime: "video/mp4",
        tempKey,
      });
      await moveStarted;

      // This is the worker's claim predicate. There must be no QUEUED row
      // until the source object is available at its final key.
      expect(
        await prisma.job.count({ where: { userId: user.id, status: "QUEUED" } }),
      ).toBe(0);

      releaseMove();
      const job = await pending;
      expect(job.status).toBe("QUEUED");
      await expect(storage.get(job.sourceKey as string)).resolves.not.toBeNull();
    } finally {
      releaseMove();
      moveSpy.mockRestore();
    }
  });

  it("rolls back rows and cleans temp when the storage move fails", async () => {
    const user = await createUser();
    const tempKey = "incoming/never-written";

    await expect(
      createJob({
        userId: user.id,
        displayName: "broken.mp4",
        detailLevel: "LOW",
        sourceExt: "mp4",
        sourceSize: TEST_BYTES.length,
        sourceMime: "video/mp4",
        tempKey,
      }),
    ).rejects.toThrow();

    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it("creates an image-backed job with a derived image source kind", async () => {
    const user = await createUser();
    const tempKey = "incoming/image-test";
    await storage.put(tempKey, new Blob([TEST_BYTES]).stream(), {
      sizeBytes: TEST_BYTES.length,
    });

    const job = await createJob({
      userId: user.id,
      displayName: "checkout-mockup.png",
      detailLevel: "MEDIUM",
      sourceExt: "png",
      sourceSize: TEST_BYTES.length,
      sourceMime: "image/png",
      tempKey,
    });
    const detail = jobToDetail(job);

    expect(job.sourceKey).toBe(`jobs/${job.id}/source.png`);
    expect(detail.source).toMatchObject({
      ext: "png",
      kind: "image",
    });
  });

  it("each upload is an independent job (upload.md B5)", async () => {
    const user = await createUser();
    const a = await createQueuedJob(user.id, "same-file.mp4");
    const b = await createQueuedJob(user.id, "same-file.mp4");
    expect(a.id).not.toBe(b.id);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(2);
  });
});
