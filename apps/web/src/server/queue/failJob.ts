import type { Job } from "@prisma/client";
import { type StageState } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { computeProgress } from "@/server/jobs/progress";
import { requeueJob, transientBudgetExhausted } from "./requeueJob";
import { activeLease, LeaseLostError } from "./lease";

export interface FailInput {
  stage: string;
  error: string;
  failureKind: "NONE" | "TRANSIENT" | "PERMANENT";
  retryable: boolean;
  retryAfterSec?: number;
  rateLimited?: boolean;
}

export type FailResult =
  | { kind: "NOT_CLAIMED" }
  | { kind: "REQUEUED"; job: Job }
  | { kind: "TERMINAL"; job: Job };

/**
 * Worker-reported job failure. Server normalization (blueprint §2):
 * - PERMANENT → terminal. PARTIAL when any stage SUCCEEDED (jobs.md B4),
 *   otherwise FAILED. PERMANENT never offers retry (B6).
 * - TRANSIENT + retryable with budget left → requeue with backoff,
 *   invisible to the user (B7). Budget exhausted → terminal with
 *   failureKind TRANSIENT (manual retry stays available, B5).
 */
export async function failJob(jobId: string, workerId: string, input: FailInput): Promise<FailResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (
    !job ||
    job.claimedBy !== workerId ||
    !job.leaseUntil ||
    job.leaseUntil.getTime() <= Date.now()
  ) {
    return { kind: "NOT_CLAIMED" };
  }

  const transientRequeue =
    input.failureKind === "TRANSIENT" &&
    input.retryable &&
    !transientBudgetExhausted(job.attempts, input.rateLimited === true);

  if (transientRequeue) {
    const requeued = await requeueJob(jobId, {
      stage: input.stage,
      attempts: job.attempts,
      retryAfterSec: input.retryAfterSec,
      rateLimited: input.rateLimited,
      workerId,
    });
    return { kind: "REQUEUED", job: requeued };
  }

  const stageStates = ((job.stageStates as StageState[]) ?? []).map((state) =>
    state.stage === input.stage
      ? {
          ...state,
          status: "FAILED" as const,
          completedAt: new Date().toISOString(),
          error: input.error,
        }
      : state,
  );

  const anySucceeded = stageStates.some((state) => state.status === "SUCCEEDED");
  const status = anySucceeded ? "PARTIAL" : "FAILED";

  const now = new Date();
  const updated = await prisma.job.updateMany({
    where: { id: jobId, ...activeLease(workerId, now) },
    data: {
      status,
      progress: computeProgress(stageStates),
      error: input.error,
      errorStage: input.stage as never,
      failureKind: input.failureKind,
      stageStates,
      claimedBy: null,
      leaseUntil: null,
      availableAt: null,
    },
  });

  if (updated.count === 0) {
    throw new LeaseLostError(jobId);
  }

  return {
    kind: "TERMINAL",
    job: await prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
  };
}
