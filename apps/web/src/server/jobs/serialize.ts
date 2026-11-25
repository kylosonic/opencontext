import type { Job } from "@prisma/client";
import type { Media } from "@prisma/client";
import {
  STAGE_NAMES,
  sourceKindForExtension,
  type JobDetail,
  type JobSummary,
  type StageState,
} from "@kylosonic/opencontext-schemas";
import { computeExpiresAt, retentionNoteFor } from "./retention";

/** Job → full API payload (GET /api/jobs/[id], worker claim payloads). */
export function jobToDetail(
  job: Job,
  sourceMedia: Media[] = [],
  canManage?: boolean,
  workspaceName?: string | null,
): JobDetail {
  const stageStates = (job.stageStates as StageState[]) ?? [];
  const sourceExt = job.sourceExt ?? "";
  const retryAllowed =
    (job.status === "PARTIAL" || job.status === "FAILED") &&
    job.failureKind !== "PERMANENT";
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
    ...(canManage !== undefined ? { canManage } : {}),
    workspaceId: job.workspaceId ?? null,
    ...(workspaceName !== undefined ? { workspaceName } : {}),
    stageStates,
    source: job.sourceKey
      ? {
          key: job.sourceKey,
          sizeBytes: job.sourceSize ?? 0,
          ext: sourceExt,
          kind: sourceKindForExtension(sourceExt),
          ...(sourceMedia.length > 0
            ? {
                assets: sourceMedia
                  .filter((media) => media.kind === "SOURCE")
                  .sort(
                    (left, right) =>
                      (left.timestampSec ?? 0) - (right.timestampSec ?? 0),
                  )
                  .map((media) => {
                    const dot = media.key.lastIndexOf(".");
                    const ext =
                      dot >= 0 ? media.key.slice(dot + 1).toLowerCase() : sourceExt;
                    return {
                      key: media.key,
                      ext,
                      mime: media.mime ?? "application/octet-stream",
                      sizeBytes: media.sizeBytes,
                      kind: sourceKindForExtension(ext),
                      order: Math.max(0, Math.round(media.timestampSec ?? 0)),
                    };
                  }),
              }
            : {}),
          ...(job.durationSec !== null ? { durationSec: job.durationSec } : {}),
          ...(job.width !== null ? { width: job.width } : {}),
          ...(job.height !== null ? { height: job.height } : {}),
          ...(job.audioPresent !== null ? { audioPresent: job.audioPresent } : {}),
          ...(job.frameCount !== null ? { frameCount: job.frameCount } : {}),
          ...(job.assetCount !== null ? { assetCount: job.assetCount } : {}),
          ...(job.pageCount !== null ? { pageCount: job.pageCount } : {}),
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
export function jobToSummary(
  job: Job,
  canManage?: boolean,
  workspaceName?: string | null,
): JobSummary {
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
    ...(canManage !== undefined ? { canManage } : {}),
    workspaceId: job.workspaceId ?? null,
    ...(workspaceName !== undefined ? { workspaceName } : {}),
    ...(job.sourceExt
      ? { sourceKind: sourceKindForExtension(job.sourceExt) }
      : {}),
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    expiresAt: computeExpiresAt(job.completedAt, job.createdAt).toISOString(),
  };
}
