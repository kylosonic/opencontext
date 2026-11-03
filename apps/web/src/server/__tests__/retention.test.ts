import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { retentionSweep } from "@/server/queue";
import { initialStageStates } from "@/server/jobs";
import { createUser, resetDatabase, resetStorage, TEST_BYTES } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

async function makeJob(userId: string, createdAt: Date, completedAt: Date | null) {
  return prisma.job.create({
    data: {
      userId,
      displayName: "expiry.mp4",
      status: completedAt ? "COMPLETED" : "FAILED",
      stageStates: initialStageStates(),
      createdAt,
      completedAt,
      sourceKey: null,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

describe("retentionSweep (jobs.md B9)", () => {
  it("deletes completed jobs older than 14 days", async () => {
    const user = await createUser();
    const stale = await makeJob(
      user.id,
      new Date(Date.now() - 15 * DAY),
      new Date(Date.now() - 14.5 * DAY),
    );
    await prisma.job.update({
      where: { id: stale.id },
      data: { sourceKey: `jobs/${stale.id}/source.mp4` },
    });
    await storage.put(`jobs/${stale.id}/source.mp4`, new Blob([TEST_BYTES]).stream(), {
      sizeBytes: TEST_BYTES.length,
    });

    const result = await retentionSweep();
    expect(result.deleted).toBe(1);
    expect(await prisma.job.count()).toBe(0);
    expect(await storage.get(`jobs/${stale.id}/source.mp4`)).toBeNull();
  });

  it("keeps completed jobs younger than 14 days", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 10 * DAY), new Date(Date.now() - 9 * DAY));
    const result = await retentionSweep();
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.job.count()).toBe(1);
  });

  it("deletes unfinished jobs older than 7 days", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 8 * DAY), null);
    const result = await retentionSweep();
    expect(result.deleted).toBe(1);
    expect(await prisma.job.count()).toBe(0);
  });

  it("keeps unfinished jobs younger than 7 days", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 3 * DAY), null);
    const result = await retentionSweep();
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.job.count()).toBe(1);
  });

  it("is idempotent — a second sweep finds nothing", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 20 * DAY), null);
    const first = await retentionSweep();
    const second = await retentionSweep();
    expect(first.deleted).toBe(1);
    expect(second).toEqual({ scanned: 0, deleted: 0 });
  });
});
