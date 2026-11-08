import { z } from "zod";
import { FailureKindSchema, StageNameSchema, StageStatusSchema } from "./job.js";
import { MediaKindSchema } from "./media.js";

/**
 * Worker API contract (ADR-0005). The Python worker mirrors these shapes
 * as pydantic models. Every job-scoped worker request carries the worker's
 * id in the `x-worker-id` header; mutations additionally accept it in the
 * body. The token travels in `Authorization: Bearer <WORKER_API_TOKEN>`.
 */

/** POST /api/worker/jobs/claim */
export const WorkerClaimRequestSchema = z.object({
  workerId: z.string().min(1).max(128),
});

export type WorkerClaimRequest = z.infer<typeof WorkerClaimRequestSchema>;

/** GET /api/worker/jobs/[id]/source */
export const WorkerSourceInfoSchema = z.object({
  uri: z.string(),
  provider: z.enum(["local", "s3"]),
  sizeBytes: z.number().int().nonnegative(),
  filename: z.string(),
});

export type WorkerSourceInfo = z.infer<typeof WorkerSourceInfoSchema>;

/** POST /api/worker/jobs/[id]/progress */
export const WorkerProgressRequestSchema = z.object({
  stage: StageNameSchema,
  stageStatus: StageStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string().optional(),
});

export type WorkerProgressRequest = z.infer<typeof WorkerProgressRequestSchema>;

/** POST /api/worker/jobs/[id]/artifacts (multipart fields besides `file`). */
export const WorkerArtifactFieldsSchema = z.object({
  kind: MediaKindSchema,
  timestampSec: z.coerce.number().optional(),
});

/** POST /api/worker/jobs/[id]/stage-result */
export const WorkerStageResultRequestSchema = z.object({
  stage: StageNameSchema,
  outcome: z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]),
  attempt: z.number().int().nonnegative(),
  error: z.string().optional(),
  reason: z.string().optional(),
  data: z.unknown().optional(),
});

export type WorkerStageResultRequest = z.infer<typeof WorkerStageResultRequestSchema>;

/** POST /api/worker/jobs/[id]/fail */
export const WorkerFailRequestSchema = z.object({
  stage: StageNameSchema,
  error: z.string().min(1),
  failureKind: FailureKindSchema,
  retryable: z.boolean().default(false),
});

export type WorkerFailRequest = z.infer<typeof WorkerFailRequestSchema>;

/** POST /api/admin/retention-sweep */
export const RetentionSweepResponseSchema = z.object({
  scanned: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});

export type RetentionSweepResponse = z.infer<typeof RetentionSweepResponseSchema>;
