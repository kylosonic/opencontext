import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { createJob } from "@/server/jobs";
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

  it("each upload is an independent job (upload.md B5)", async () => {
    const user = await createUser();
    const a = await createQueuedJob(user.id, "same-file.mp4");
    const b = await createQueuedJob(user.id, "same-file.mp4");
    expect(a.id).not.toBe(b.id);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(2);
  });
});
