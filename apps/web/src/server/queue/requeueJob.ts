import type { Prisma } from "@prisma/client";
import { type StageState } from "@opencontext/schemas";
import { prisma } from "@/server/db/prisma";
import { BACKOFF_MS, QUEUE_MAX_ATTEMPTS } from "./claimJob";

/**
 * Re-queue a job after a transient failure (jobs.md B7 — invisible auto
 * retry). Releases the lease and delays re-claim by the backoff for the
 * current attempt count. The failed stage resets to NOT_STARTED so the
 * worker re-runs it from scratch on re-claim; completed stages are
 * untouched (resume semantics, blueprint §4).
 */
export async function requeueJob(
  jobId: string,
  options: { stage?: string; attempts?: number },
) {
  const attempts = options.attempts ?? 0;
  const backoff = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];

  return prisma.$transaction(async (tx) => {
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

    return tx.job.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        error: null,
        errorStage: null,
        claimedBy: null,
        leaseUntil: null,
        availableAt: new Date(Date.now() + backoff),
        stageStates: stageStates as Prisma.InputJsonValue,
      },
    });
  });
}

/** Whether the transient retry budget is exhausted (B7). */
export function transientBudgetExhausted(attempts: number): boolean {
  return attempts >= QUEUE_MAX_ATTEMPTS;
}
