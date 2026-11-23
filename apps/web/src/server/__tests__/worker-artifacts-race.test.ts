import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { LeaseLostError } from "@/server/queue";
import { getStorage, storage } from "@/server/storage";
import { storeArtifact } from "@/server/worker/artifacts";
import { createQueuedJob, createUser, resetDatabase, resetStorage } from "./helpers";

const originalBytes = new Uint8Array([9, 8, 7, 6]);

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

describe("worker artifact lease fencing", () => {
  it("does not delete the live artifact when a stale worker loses its lease", async () => {
    const user = await createUser();
    const queued = await createQueuedJob(user.id);
    const staleWorker = "worker-stale";
    const liveWorker = "worker-live";
    const liveKey = `jobs/${queued.id}/artifacts/frame/1-live.jpg`;
    await storage.put(liveKey, new Blob([originalBytes]).stream(), {
      sizeBytes: originalBytes.length,
    });
    await prisma.media.create({
      data: {
        jobId: queued.id,
        kind: "FRAME",
        key: liveKey,
        mime: "image/jpeg",
        sizeBytes: originalBytes.length,
        timestampSec: 1,
      },
    });
    const staleJob = await prisma.job.update({
      where: { id: queued.id },
      data: {
        claimedBy: staleWorker,
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });

    const storageBackend = getStorage();
    const originalPut = storageBackend.put.bind(storageBackend);
    const putSpy = vi.spyOn(storageBackend, "put").mockImplementation(
      async (key, body, options) => {
        await originalPut(key, body, options);
        // Simulate a reclaim after the stale pre-write fence but before its
        // post-transfer commit fence.
        await prisma.job.update({
          where: { id: queued.id },
          data: {
            claimedBy: liveWorker,
            leaseUntil: new Date(Date.now() + 60_000),
          },
        });
      },
    );

    try {
      await expect(
        storeArtifact(staleJob, {
          kind: "FRAME",
          timestampSec: 1,
          filename: "frame.jpg",
          mime: "image/jpeg",
          sizeBytes: originalBytes.length,
          body: new Blob([new Uint8Array([1, 2, 3, 4])]).stream(),
        }),
      ).rejects.toBeInstanceOf(LeaseLostError);

      expect(await storage.get(liveKey)).toEqual(originalBytes);
      const liveMedia = await prisma.media.findFirst({
        where: { jobId: queued.id, kind: "FRAME", timestampSec: 1 },
      });
      expect(liveMedia?.key).toBe(liveKey);
    } finally {
      putSpy.mockRestore();
    }
  });
});
