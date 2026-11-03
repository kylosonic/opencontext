import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import { claimJob, isClaimable, LEASE_MS, requeueJob } from "@/server/queue";
import { createQueuedJob, createUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("claimJob — portable atomic claim (ADR-0001)", () => {
  it("claims an idle queued job", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);

    const claimed = await claimJob({ workerId: "worker-a" });
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.claimedBy).toBe("worker-a");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("never double-claims under concurrency", async () => {
    const user = await createUser();
    await createQueuedJob(user.id);

    const [a, b] = await Promise.all([
      claimJob({ workerId: "worker-a" }),
      claimJob({ workerId: "worker-b" }),
    ]);
    const winners = [a, b].filter((job) => job !== null);
    expect(winners).toHaveLength(1);
    const claimedBy = new Set(winners.map((job) => job?.claimedBy));
    expect(claimedBy.size).toBe(1);
  });

  it("does not claim a job whose lease is still held", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });

    const second = await claimJob({ workerId: "worker-b" });
    expect(second).toBeNull();

    const fresh = await prisma.job.findUnique({ where: { id: job.id } });
    expect(fresh?.claimedBy).toBe("worker-a");
  });

  it("re-claims after the lease expires (visibility timeout)", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });

    await prisma.job.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });

    const reclaimed = await claimJob({ workerId: "worker-b" });
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.claimedBy).toBe("worker-b");
    expect(reclaimed?.attempts).toBe(2);
  });

  it("respects availableAt backoff from a transient requeue", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });

    await requeueJob(job.id, { stage: "EXTRACTING", attempts: 1 });

    const immediate = await claimJob({ workerId: "worker-b" });
    expect(immediate).toBeNull();

    await prisma.job.update({
      where: { id: job.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const later = await claimJob({ workerId: "worker-b" });
    expect(later?.id).toBe(job.id);
  });

  it("returns null when the queue is idle", async () => {
    const user = await createUser();
    await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });

    // Lease held → idle for everyone else.
    expect(await claimJob({ workerId: "worker-c" })).toBeNull();
  });
});

describe("isClaimable predicate", () => {
  const base = {
    status: "QUEUED",
    claimedBy: null as string | null,
    leaseUntil: null as Date | null,
    availableAt: null as Date | null,
  };

  it("claimable when free", () => {
    expect(isClaimable(base)).toBe(true);
  });

  it("not claimable while claimed with a live lease", () => {
    expect(
      isClaimable({
        ...base,
        claimedBy: "w1",
        leaseUntil: new Date(Date.now() + LEASE_MS),
      }),
    ).toBe(false);
  });

  it("claimable after lease expiry even while claimedBy is set", () => {
    expect(
      isClaimable({
        ...base,
        claimedBy: "w1",
        leaseUntil: new Date(Date.now() - 1000),
      }),
    ).toBe(true);
  });

  it("not claimable before availableAt", () => {
    expect(
      isClaimable({ ...base, availableAt: new Date(Date.now() + 60_000) }),
    ).toBe(false);
  });

  it("not claimable when not QUEUED", () => {
    expect(isClaimable({ ...base, status: "COMPLETED" })).toBe(false);
  });
});
