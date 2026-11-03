import type { Job } from "@prisma/client";
import {
  STAGE_NAMES,
  type JobDetail,
  type JobSummary,
  type StageState,
} from "@opencontext/schemas";
import { computeExpiresAt, retentionNoteFor } from "./retention";

/** Job → full API payload (GET /api/jobs/[id], worker claim payloads). */
export function jobToDetail(job: Job): JobDetail {
  const stageStates = (job.stageStates as StageState[]) ?? [];
  const retryAllowed =
    job.status === "PARTIAL" ||
    (job.status === "FAILED" && job.failureKind === "TRANSIENT");
  return {
    id: job.id,
    displayName: job.displayName,
    status: job.status,
    detailLevel: job.detailLevel,
    progress: job.progress,
    error: job.error,
    errorStage: job.errorStage,
    failureKind: job.failureKind,
    retryCount: job.retryCount,
    retryAllowed,
    stageStates,
    source: job.sourceKey
      ? {
          key: job.sourceKey,
          sizeBytes: job.sourceSize ?? 0,
          ext: job.sourceExt ?? "",
          ...(job.durationSec !== null ? { durationSec: job.durationSec } : {}),
          ...(job.width !== null ? { width: job.width } : {}),
          ...(job.height !== null ? { height: job.height } : {}),
          ...(job.audioPresent !== null ? { audioPresent: job.audioPresent } : {}),
          ...(job.frameCount !== null ? { frameCount: job.frameCount } : {}),
        }
      : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    expiresAt: computeExpiresAt(job.completedAt, job.createdAt).toISOString(),
    retentionNote: retentionNoteFor(job.completedAt),
  };
}

/** Job → list card payload (GET /api/jobs, jobs.md B8). */
export function jobToSummary(job: Job): JobSummary {
  const currentStage = (STAGE_NAMES as readonly string[]).includes(job.status)
    ? (job.status as JobSummary["currentStage"])
    : null;
  return {
    id: job.id,
    displayName: job.displayName,
    status: job.status,
    detailLevel: job.detailLevel,
    progress: job.progress,
    currentStage,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    expiresAt: computeExpiresAt(job.completedAt, job.createdAt).toISOString(),
  };
}
