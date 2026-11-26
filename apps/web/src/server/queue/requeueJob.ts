import type { Prisma } from "@prisma/client";
import { type StageState } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { computeProgress } from "@/server/jobs/progress";
import { notifyWorkerJobQueued } from "./dispatchWorker";
import {
  BACKOFF_MS,
  QUEUE_MAX_ATTEMPTS,
  RATE_LIMIT_MAX_ATTEMPTS,
} from "./claimJob";
import { activeLease, LeaseLostError } from "./lease";

/**
 * Re-queue a job after a transient failure (jobs.md B7 — invisible auto
 * retry). Releases the lease and delays re-claim by the backoff for the
 * current attempt count. The failed stage resets to NOT_STARTED so the
 * worker re-runs it from scratch on re-claim; completed stages are
 * untouched (resume semantics, blueprint §4).
 */
export async function requeueJob(
  jobId: string,
  options: {
    stage?: string;
    attempts?: number;
    retryAfterSec?: number;
    rateLimited?: boolean;
    workerId?: string;
  },
) {
  const attempts = options.attempts ?? 0;
  const backoff = options.rateLimited
    ? Math.min(
        15 * 60_000,
        60_000 * 2 ** Math.max(0, Math.min(4, attempts - 1)),
      )
    : BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
  const retryAfterMs = Math.min(
    15 * 60_000,
    Math.max(0, options.retryAfterSec ?? 0) * 1_000,
  );

  const requeued = await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new Error(`Cannot requeue missing job ${jobId}`);
    }
    const stageStates = ((job.stageStates as StageState[]) ?? []).map((state) =>
      state.stage === options.stage
        ? {
            ...state,
            status: "NOT_STARTED" as const,
            progress: 0,
            startedAt: null,
            completedAt: null,
            error: null,
          }
        : state,
    );

    const now = new Date();
    const data = {
      status: "QUEUED" as const,
      progress: computeProgress(stageStates as StageState[]),
      error: null,
      errorStage: null,
      // Keep a durable marker for provider-quota deferrals. The claim guard
      // uses it to apply the larger bounded quota budget, while ordinary
      // transient failures retain the five-attempt poison-job ceiling.
      failureKind: options.rateLimited ? ("TRANSIENT" as const) : ("NONE" as const),
      claimedBy: null,
      leaseUntil: null,
      availableAt: new Date(now.getTime() + Math.max(backoff, retryAfterMs)),
      stageStates: stageStates as Prisma.InputJsonValue,
    };
    if (options.workerId) {
      const released = await tx.job.updateMany({
        where: { id: jobId, ...activeLease(options.workerId, now) },
        data,
      });
      if (released.count === 0) {
        throw new LeaseLostError(jobId);
      }
      return tx.job.findUniqueOrThrow({ where: { id: jobId } });
    }
    return tx.job.update({ where: { id: jobId }, data });
  });
  await notifyWorkerJobQueued(jobId);
  return requeued;
}

/** Whether the transient retry budget is exhausted (B7). */
export function transientBudgetExhausted(
  attempts: number,
  rateLimited = false,
): boolean {
  return attempts >= (rateLimited ? RATE_LIMIT_MAX_ATTEMPTS : QUEUE_MAX_ATTEMPTS);
}
