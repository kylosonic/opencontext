import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  claimJob,
  completeJob,
  isClaimable,
  LEASE_MS,
  QUEUE_MAX_ATTEMPTS,
  RATE_LIMIT_MAX_ATTEMPTS,
  requeueJob,
  transientBudgetExhausted,
} from "@/server/queue";
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

  it("recovers an active stage after its worker lease expires", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "ANALYZING",
        leaseUntil: new Date(Date.now() - 1000),
      },
    });

    const recovered = await claimJob({ workerId: "worker-b" });

    expect(recovered?.id).toBe(job.id);
    expect(recovered?.status).toBe("ANALYZING");
    expect(recovered?.claimedBy).toBe("worker-b");
    expect(recovered?.attempts).toBe(2);
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

  it("defers a requeue to the provider's retry window", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });
    const before = Date.now();

    await requeueJob(job.id, {
      stage: "ANALYZING",
      attempts: 1,
      retryAfterSec: 120,
    });

    const requeued = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(requeued.availableAt?.getTime()).toBeGreaterThanOrEqual(before + 119_000);
    expect(await claimJob({ workerId: "worker-b" })).toBeNull();
  });

  it("gives provider rate limits a larger bounded retry budget", () => {
    expect(transientBudgetExhausted(QUEUE_MAX_ATTEMPTS, false)).toBe(true);
    expect(transientBudgetExhausted(QUEUE_MAX_ATTEMPTS, true)).toBe(false);
    expect(transientBudgetExhausted(40, true)).toBe(true);
  });

  it("uses escalating cooldowns for repeated provider throttles", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });
    const before = Date.now();

    await requeueJob(job.id, {
      stage: "ANALYZING",
      attempts: 4,
      retryAfterSec: 60,
      rateLimited: true,
      workerId: "worker-a",
    });

    const requeued = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(requeued.availableAt?.getTime()).toBeGreaterThanOrEqual(before + 479_000);
  });

  it("returns null when the queue is idle", async () => {
    const user = await createUser();
    await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });

    // Lease held → idle for everyone else.
    expect(await claimJob({ workerId: "worker-c" })).toBeNull();
  });

  it("fails a poison job when its claim budget is exhausted", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "ANALYZING",
        claimedBy: "worker-a",
        leaseUntil: new Date(Date.now() - 1_000),
        attempts: QUEUE_MAX_ATTEMPTS,
      },
    });

    expect(await claimJob({ workerId: "worker-b" })).toBeNull();
    const failed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.claimedBy).toBeNull();
    expect(failed.failureKind).toBe("TRANSIENT");
  });

  it("keeps provider-rate-limited jobs claimable beyond the poison-job limit", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "ANALYZING",
        claimedBy: null,
        leaseUntil: null,
        attempts: QUEUE_MAX_ATTEMPTS,
        failureKind: "TRANSIENT",
      },
    });

    const claimed = await claimJob({ workerId: "worker-b" });

    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempts).toBe(QUEUE_MAX_ATTEMPTS + 1);
    expect(claimed?.failureKind).toBe("NONE");
  });

  it("preserves completed results as PARTIAL when an exhausted job has progress", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    const stageStates = (
      job.stageStates as Array<Record<string, unknown>>
    ).map((state, index) => ({
      ...state,
      status: index === 0 ? "SUCCEEDED" : index === 1 ? "RUNNING" : "NOT_STARTED",
    }));
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "ANALYZING",
        claimedBy: null,
        leaseUntil: null,
        attempts: QUEUE_MAX_ATTEMPTS,
        failureKind: "NONE",
        stageStates,
      },
    });

    expect(await claimJob({ workerId: "worker-b" })).toBeNull();
    const failed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const failedStates = failed.stageStates as Array<{
      stage: string;
      status: string;
      error?: string;
    }>;

    expect(failed.status).toBe("PARTIAL");
    expect(failed.errorStage).toBe("TRANSCRIBING");
    expect(failedStates[0].status).toBe("SUCCEEDED");
    expect(failedStates[1].status).toBe("FAILED");
    expect(failedStates[1].error).toContain("budget exhausted");
  });

  it("fails a rate-limited job at the larger bounded quota budget", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "ANALYZING",
        claimedBy: null,
        leaseUntil: null,
        attempts: RATE_LIMIT_MAX_ATTEMPTS,
        failureKind: "TRANSIENT",
      },
    });

    expect(await claimJob({ workerId: "worker-b" })).toBeNull();
    const failed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
  });
});

describe("completion fencing", () => {
  it("is idempotent after the lease is released", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    const claimed = await claimJob({ workerId: "worker-a" });
    const states = (claimed!.stageStates as Array<Record<string, unknown>>).map((state) => ({
      ...state,
      status: "SUCCEEDED",
    }));
    await prisma.job.update({ where: { id: job.id }, data: { stageStates: states } });

    const first = await completeJob(job.id, "worker-a");
    expect(first.kind).toBe("OK");
    // Simulate a process interruption after the job transition but before the
    // best-effort usage write. The idempotent completion retry must repair it.
    await prisma.usageRecord.deleteMany({ where: { jobId: job.id } });
    const retried = await completeJob(job.id, "worker-a");
    expect(retried.kind).toBe("OK");
    expect(retried.kind === "OK" && retried.job.status).toBe("COMPLETED");
    expect(await prisma.usageRecord.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("never promotes a job containing a failed stage", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    const claimed = await claimJob({ workerId: "worker-a" });
    const states = (claimed!.stageStates as Array<Record<string, unknown>>).map(
      (state, index) => ({ ...state, status: index === 0 ? "FAILED" : "SUCCEEDED" }),
    );
    await prisma.job.update({ where: { id: job.id }, data: { stageStates: states } });

    await expect(completeJob(job.id, "worker-a")).resolves.toMatchObject({
      kind: "STAGES_FAILED",
    });
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
