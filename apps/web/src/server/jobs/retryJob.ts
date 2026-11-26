import { Prisma } from "@prisma/client";
import { type StageState } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { notifyWorkerJobQueued } from "@/server/queue/dispatchWorker";
import { computeProgress } from "./progress";
import { jobToDetail } from "./serialize";
import { canManageJob } from "@/server/workspaces";

/**
 * Stages whose results are always recomputed on manual retry (blueprint
 * §1 retry-storage contract: "AGGREGATING and GENERATING_CONTEXT always
 * reset (cheap downstream consumers)").
 */
const ALWAYS_RESET_STAGES: ReadonlySet<string> = new Set([
  "AGGREGATING",
  "GENERATING_CONTEXT",
]);

export type RetryResult =
  | { kind: "RETRY_NOT_ALLOWED"; reason: string }
  | { kind: "OK"; job: ReturnType<typeof jobToDetail> };

/**
 * Manual retry (jobs.md B5): only PARTIAL jobs, or FAILED jobs with
 * `failureKind=TRANSIENT`, may be retried (B6: PERMANENT failures cannot
 * be helped by re-running). Failed and not-yet-run stages reset;
 * SUCCEEDED/SKIPPED stages and their stored results stay untouched so the
 * worker skips them on re-claim. Same job id, same URL.
 */
export async function retryJob(jobId: string, userId: string): Promise<RetryResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { kind: "RETRY_NOT_ALLOWED", reason: "NOT_FOUND" };
  }
  if (!(await canManageJob(job, userId))) {
    return { kind: "RETRY_NOT_ALLOWED", reason: "FORBIDDEN" };
  }

  // PERMANENT failures and completed jobs cannot be retried, even when a
  // permanent failure left an earlier stage's PARTIAL output visible.
  const allowed =
    (job.status === "PARTIAL" || job.status === "FAILED") &&
    job.failureKind === "TRANSIENT";
  if (!allowed) {
    return {
      kind: "RETRY_NOT_ALLOWED",
      reason: `Job status ${job.status} with failure kind ${job.failureKind} cannot be retried`,
    };
  }

  const resetStage = (state: StageState): StageState => ({
    stage: state.stage,
    status: "NOT_STARTED",
    attempt: 0,
    progress: 0,
    startedAt: null,
    completedAt: null,
    error: null,
  });

  const stageStates = ((job.stageStates as StageState[]) ?? []).map((state) => {
    if (ALWAYS_RESET_STAGES.has(state.stage)) {
      return resetStage(state);
    }
    if (state.status === "FAILED" || state.status === "RUNNING") {
      return resetStage(state);
    }
    return state;
  });

  const resetStages = new Set(
    ((job.stageStates as StageState[]) ?? [])
      .filter(
        (state) =>
          ALWAYS_RESET_STAGES.has(state.stage) ||
          state.status === "FAILED" ||
          state.status === "RUNNING",
      )
      .map((state) => state.stage),
  );

  const result = await prisma.$transaction(async (tx) => {
    // CAS on the terminal state prevents a concurrent delete/retry from
    // resurrecting a job that was removed after the initial read.
    const changed = await tx.job.updateMany({
      where: {
        id: jobId,
        status: job.status,
        failureKind: job.failureKind,
        updatedAt: job.updatedAt,
      },
      data: {
        status: "QUEUED",
        progress: computeProgress(stageStates),
        error: null,
        errorStage: null,
        failureKind: "NONE",
        retryCount: { increment: 1 },
        stageStates,
        timeline: Prisma.DbNull,
        claimedBy: null,
        leaseUntil: null,
        availableAt: null,
        attempts: 0,
      },
    });
    if (changed.count === 0) return null;

    if (resetStages.has("ANALYZING")) {
      await tx.visualObservation.deleteMany({ where: { jobId } });
      await tx.ocrObservation.deleteMany({ where: { jobId } });
    }
    if (resetStages.has("TRANSCRIBING")) {
      await tx.transcriptSegment.deleteMany({ where: { jobId } });
    }
    await tx.processingResult.deleteMany({ where: { jobId } });

    const updated = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    const sourceMedia = await tx.media.findMany({
      where: { jobId, kind: "SOURCE" },
    });
    return jobToDetail(updated, sourceMedia);
  });
  if (result === null) {
    const current = await prisma.job.findUnique({ where: { id: jobId } });
    return {
      kind: "RETRY_NOT_ALLOWED",
      reason: current ? "CONFLICT" : "NOT_FOUND",
    };
  }

  await notifyWorkerJobQueued(jobId);
  return { kind: "OK", job: result };
}
