import { z } from "zod";

/** All states a processing job can be in across the pipeline lifecycle. */
export const JOB_STATUSES = [
  "QUEUED",
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JobStatusSchema = z.enum(JOB_STATUSES);

/** Ordered stages of the media-to-context pipeline. */
export const PIPELINE_STAGES = [
  "downloading",
  "extracting",
  "transcribing",
  "analyzing",
  "aggregating",
  "generating_context",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Context detail levels a user can request. */
export const DETAIL_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const DetailLevelSchema = z.enum(DETAIL_LEVELS);

/** Upload acceptance limits for media files. */
export const UPLOAD_LIMITS = {
  maxBytes: 500 * 1024 * 1024,
  maxDurationSec: 1800,
  allowedExtensions: [".mp4", ".mov", ".webm", ".mkv"],
} as const;

/** Data retention windows (days). */
export const RETENTION = {
  completedDays: 14,
  incompleteDays: 7,
} as const;

/** Client polling cadence for job status updates (ms). */
export const POLL_INTERVAL_MS = 3000;
