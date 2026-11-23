import { z } from "zod";
import {
  FailureKindSchema,
  SourceKindSchema,
  StageNameSchema,
  StageStatusSchema,
} from "./job.js";
import { MediaKindSchema } from "./media.js";

/**
 * Worker API contract (ADR-0005). The Python worker mirrors these shapes
 * as pydantic models. Every job-scoped worker request carries the worker's
 * id in the `x-worker-id` header; mutations additionally accept it in the
 * body. The token travels in `Authorization: Bearer <WORKER_API_TOKEN>`.
 */

/** POST /api/worker/jobs/claim */
export const WorkerClaimRequestSchema = z.object({
  workerId: z.string().trim().min(1).max(128),
});

export type WorkerClaimRequest = z.infer<typeof WorkerClaimRequestSchema>;

/** GET /api/worker/jobs/[id]/source */
export const WorkerSourceInfoSchema = z.object({
  uri: z.string().min(1).max(8_192),
  provider: z.enum(["local", "s3"]),
  sizeBytes: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  kind: SourceKindSchema,
  assets: z
    .array(
      z.object({
        uri: z.string().min(1).max(8_192),
        provider: z.enum(["local", "s3"]),
        sizeBytes: z.number().int().nonnegative(),
        filename: z.string().min(1).max(255),
        kind: SourceKindSchema,
        ext: z.string().min(1).max(16),
        mime: z.string().min(1).max(128),
        order: z.number().int().nonnegative(),
      }),
    )
    .max(10)
    .optional(),
});

export type WorkerSourceInfo = z.infer<typeof WorkerSourceInfoSchema>;

/** POST /api/worker/jobs/[id]/progress */
export const WorkerProgressRequestSchema = z.object({
  stage: StageNameSchema,
  stageStatus: StageStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string().max(2_000).optional(),
});

export type WorkerProgressRequest = z.infer<typeof WorkerProgressRequestSchema>;

/** POST /api/worker/jobs/[id]/heartbeat */
export const WorkerHeartbeatRequestSchema = z.object({
  stage: StageNameSchema,
  progress: z.number().int().min(0).max(100),
});

export type WorkerHeartbeatRequest = z.infer<typeof WorkerHeartbeatRequestSchema>;

/** POST /api/worker/jobs/[id]/artifacts (multipart fields besides `file`). */
export const WorkerArtifactFieldsSchema = z.object({
  kind: MediaKindSchema,
  timestampSec: z.coerce.number().finite().nonnegative().max(86_400).optional(),
});

/** POST /api/worker/jobs/[id]/stage-result */
export const WorkerStageResultRequestSchema = z.object({
  stage: StageNameSchema,
  outcome: z.enum(["SUCCEEDED", "FAILED", "SKIPPED"]),
  attempt: z.number().int().nonnegative(),
  error: z.string().max(20_000).optional(),
  reason: z.string().max(2_000).optional(),
  data: z.unknown().optional(),
});

export type WorkerStageResultRequest = z.infer<typeof WorkerStageResultRequestSchema>;

/** POST /api/worker/jobs/[id]/fail */
export const WorkerFailRequestSchema = z
  .object({
    stage: StageNameSchema,
    error: z.string().min(1).max(20_000),
    failureKind: FailureKindSchema,
    retryable: z.boolean().default(false),
    retryAfterSec: z.number().int().min(0).max(900).optional(),
    rateLimited: z.boolean().default(false),
  })
  .refine((request) => request.failureKind !== "NONE", {
    message: "failureKind must be TRANSIENT or PERMANENT",
    path: ["failureKind"],
  });

export type WorkerFailRequest = z.infer<typeof WorkerFailRequestSchema>;

/** POST /api/admin/retention-sweep */
export const RetentionSweepResponseSchema = z.object({
  scanned: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});

export type RetentionSweepResponse = z.infer<typeof RetentionSweepResponseSchema>;
