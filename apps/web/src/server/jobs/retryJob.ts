import { type StageState } from "@opencontext/schemas";
import { prisma } from "@/server/db/prisma";
import { computeProgress } from "./progress";
import { jobToDetail } from "./serialize";

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
  if (job.userId !== userId) {
    return { kind: "RETRY_NOT_ALLOWED", reason: "FORBIDDEN" };
  }

  const allowed =
    job.status === "PARTIAL" ||
    (job.status === "FAILED" && job.failureKind === "TRANSIENT");
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
    if (state.status === "FAILED") {
      return resetStage(state);
    }
    return state;
  });

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      progress: computeProgress(stageStates),
      error: null,
      errorStage: null,
      failureKind: "NONE",
      retryCount: { increment: 1 },
      stageStates,
      claimedBy: null,
      leaseUntil: null,
      availableAt: null,
      attempts: 0,
    },
  });

  return { kind: "OK", job: jobToDetail(updated) };
}
