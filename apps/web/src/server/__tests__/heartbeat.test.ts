import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { claimJob, LEASE_MS, LeaseLostError } from "@/server/queue";
import { applyHeartbeat, applyProgress } from "@/server/worker";
import { createQueuedJob, createUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("worker lease heartbeat", () => {
  it("renews the lease without changing stage state or progress", async () => {
    const user = await createUser();
    const queued = await createQueuedJob(user.id);
    const claimed = await claimJob({ workerId: "worker-a" });
    expect(claimed?.id).toBe(queued.id);

    const before = await prisma.job.findUniqueOrThrow({ where: { id: queued.id } });
    const renewed = await applyHeartbeat(before);

    expect(renewed.stageStates).toEqual(before.stageStates);
    expect(renewed.progress).toBe(before.progress);
    expect(renewed.status).toBe(before.status);
    expect(renewed.leaseUntil!.getTime()).toBeGreaterThan(Date.now() + LEASE_MS - 5_000);
  });

  it("keeps a running job unclaimable beyond its original lease", async () => {
    const user = await createUser();
    const queued = await createQueuedJob(user.id);
    const claimed = await claimJob({ workerId: "worker-a" });
    expect(claimed).not.toBeNull();

    await applyProgress(claimed!, {
      stage: "TRANSCRIBING",
      stageStatus: "RUNNING",
      progress: 10,
    });
    await prisma.job.update({
      where: { id: queued.id },
      data: { leaseUntil: new Date(Date.now() - 1_000) },
    });
    const expired = await prisma.job.findUniqueOrThrow({ where: { id: queued.id } });
    await expect(applyHeartbeat(expired)).rejects.toBeInstanceOf(LeaseLostError);

    const replacement = await claimJob({ workerId: "worker-b" });
    expect(replacement?.claimedBy).toBe("worker-b");

    // The old worker still has a row object carrying its id, but the
    // conditional fence prevents it from overwriting the new claim.
    await expect(
      applyProgress(expired, {
        stage: "ANALYZING",
        stageStatus: "RUNNING",
        progress: 99,
      }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    const after = await prisma.job.findUniqueOrThrow({ where: { id: queued.id } });
    expect(after.claimedBy).toBe("worker-b");
    expect(after.progress).toBe(expired.progress);
  });
});
