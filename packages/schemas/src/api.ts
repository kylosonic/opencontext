import { z } from "zod";
import {
  DetailLevelSchema,
  FailureKindSchema,
  JobStatusSchema,
  SourceMetaSchema,
  StageNameSchema,
  StageStatesSchema,
} from "./job.js";

/**
 * Job list card payload (GET /api/jobs, jobs.md B8: filename, status badge,
 * current stage, progress bar, created time, error summary).
 */
export const JobSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: JobStatusSchema,
  detailLevel: DetailLevelSchema,
  progress: z.number().int().min(0).max(100),
  currentStage: StageNameSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
});

export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobListResponseSchema = z.array(JobSummarySchema);

/**
 * Full job state (GET /api/jobs/[id]) — stageStates, progress, error
 * details, source probe metadata, and the retention window.
 */
export const JobDetailSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: JobStatusSchema,
  detailLevel: DetailLevelSchema,
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  errorStage: StageNameSchema.nullable(),
  failureKind: FailureKindSchema,
  retryCount: z.number().int().nonnegative(),
  retryAllowed: z.boolean(),
  stageStates: StageStatesSchema,
  source: z
    .object({
      key: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      ext: z.string(),
    })
    .and(SourceMetaSchema)
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
  retentionNote: z.string(),
});

export type JobDetail = z.infer<typeof JobDetailSchema>;

/** POST /api/jobs (multipart) — 201 response is the created job summary. */
export const CreateJobResponseSchema = JobSummarySchema;

export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;

/** POST /api/jobs/[id]/retry — 200 response is the updated job state. */
export const RetryJobResponseSchema = JobDetailSchema;

export type RetryJobResponse = z.infer<typeof RetryJobResponseSchema>;
