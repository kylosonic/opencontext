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

/** Source media accepted by the analysis pipeline. */
export const SOURCE_KINDS = ["video", "image", "pdf", "audio"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SourceKindSchema = z.enum(SOURCE_KINDS);

/** Upload acceptance limits for media files. */
export const UPLOAD_LIMITS = {
  maxBytes: 500 * 1024 * 1024,
  maxImageBytes: 25 * 1024 * 1024,
  maxPdfBytes: 50 * 1024 * 1024,
  maxAudioBytes: 100 * 1024 * 1024,
  maxImageCount: 10,
  maxImagePixels: 40_000_000,
  maxPdfPages: 30,
  maxDurationSec: 1800,
  allowedExtensions: [
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".pdf",
    ".mp3",
    ".m4a",
    ".wav",
    ".ogg",
    ".aac",
    ".flac",
  ],
  allowedMimeTypes: [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-matroska",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/aac",
    "audio/flac",
  ],
  imageExtensions: [".png", ".jpg", ".jpeg", ".webp"],
  audioExtensions: [".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"],
  intentTtlSec: 15 * 60,
} as const;

/** Infer whether a stored source extension represents a still image. */
export function sourceKindForExtension(extension: string): SourceKind {
  const normalized = extension.startsWith(".")
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  if ((UPLOAD_LIMITS.audioExtensions as readonly string[]).includes(normalized)) {
    return "audio";
  }
  return (UPLOAD_LIMITS.imageExtensions as readonly string[]).includes(
    normalized,
  )
    ? "image"
    : normalized === ".pdf"
      ? "pdf"
      : "video";
}

/** Data retention windows (days). */
export const RETENTION = {
  completedDays: 14,
  incompleteDays: 7,
} as const;

/** Client polling fallback cadence for job status updates (ms). */
export const POLL_INTERVAL_MS = 3000;

/** Pipeline stage identifiers persisted in `Job.stageStates`. */
export const STAGE_NAMES = [
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const StageNameSchema = z.enum(STAGE_NAMES);

/** Lifecycle state of a single pipeline stage. */
export const STAGE_STATUSES = [
  "NOT_STARTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

export const StageStatusSchema = z.enum(STAGE_STATUSES);

/** Why a job failed (or nothing, when it has not failed). */
export const FAILURE_KINDS = ["NONE", "TRANSIENT", "PERMANENT"] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export const FailureKindSchema = z.enum(FAILURE_KINDS);

/**
 * Progress contribution of each stage (percent of the whole pipeline).
 * Sums to 100; the API derives overall progress from stageStates using
 * these weights.
 */
export const STAGE_WEIGHTS: Record<StageName, number> = {
  EXTRACTING: 20,
  TRANSCRIBING: 25,
  ANALYZING: 35,
  AGGREGATING: 10,
  GENERATING_CONTEXT: 10,
};

/**
 * One entry of `Job.stageStates` — the single authority for stage
 * completion (powers partial-failure display and manual retry resume).
 *
 * `progress` is the worker-reported intra-stage fraction (0–100) used to
 * give a RUNNING stage partial credit toward the overall job progress.
 */
export const StageStateSchema = z.object({
  stage: StageNameSchema,
  status: StageStatusSchema,
  attempt: z.number().int().nonnegative(),
  progress: z.number().int().min(0).max(100).optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
});

export type StageState = z.infer<typeof StageStateSchema>;

export const StageStatesSchema = z.array(StageStateSchema).length(5);

/** Job-level source metadata produced by the EXTRACTING probe. */
export const SourceMetaSchema = z.object({
  durationSec: z.number().finite().nonnegative().max(86_400).optional(),
  width: z.number().int().nonnegative().max(100_000).optional(),
  height: z.number().int().nonnegative().max(100_000).optional(),
  audioPresent: z.boolean().optional(),
  frameCount: z.number().int().nonnegative().max(100_000).optional(),
  assetCount: z.number().int().positive().max(10).optional(),
  pageCount: z.number().int().positive().max(30).optional(),
});

export type SourceMeta = z.infer<typeof SourceMetaSchema>;
