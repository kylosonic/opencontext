import type {
  DetailLevel,
  JobDetail,
  JobStatus,
  StageName,
  StageState,
} from "@opencontext/schemas";
import type {
  AnalysisResultView,
  JobHeaderView,
  JobStatusView,
  StageState as ViewStageState,
  StageStatus as ViewStageStatus,
  TranscriptSegmentView,
  VisualObservationView,
  OcrEntryView,
  TimelineEntryView,
} from "@/components/results/types";

/**
 * Pure mappers from API/DB shapes onto the results-shell view contract
 * (components/results/types.ts). This module is the single place where
 * real-job data is translated for the viewer; the demo payload maps
 * through the same view types so both surfaces render identically.
 *
 * Client-safe: no node, prisma, or react imports (type-only schemas).
 */

/** Polling cadence while a job is active (jobs.md B3); mirrors schemas. */
export const POLL_INTERVAL_MS = 3000;

/** Statuses that mean "keep polling" (jobs.md B3). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  "QUEUED",
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
] as const;

/** Statuses after which polling stops and results may exist. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "COMPLETED",
  "PARTIAL",
  "FAILED",
] as const;

export function isActiveStatus(status: JobStatus): boolean {
  return (ACTIVE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function isTerminalStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

/** Display names for the five tracked pipeline stages (jobs.md B1/B2). */
export const STAGE_DISPLAY_NAMES: Record<StageName, string> = {
  EXTRACTING: "Extracting audio and frames",
  TRANSCRIBING: "Transcribing speech",
  ANALYZING: "Analyzing visual frames",
  AGGREGATING: "Aggregating context",
  GENERATING_CONTEXT: "Generating developer context",
};

/** Human label for a stage id, falling back to a readable raw name. */
export function stageDisplayName(stage: string): string {
  return (
    STAGE_DISPLAY_NAMES[stage as StageName] ??
    stage.toLowerCase().replaceAll("_", " ")
  );
}

const STAGE_STATUS_VIEW: Record<StageState["status"], ViewStageStatus> = {
  NOT_STARTED: "pending",
  RUNNING: "running",
  SUCCEEDED: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
};

/**
 * Job.stageStates → checklist rows for the results shell. The shell's
 * StageState rows carry display names and shell statuses; this maps the
 * Prisma StageStatus enum onto {pending, running, done, failed, skipped}.
 */
export function stageChecklistView(stageStates: StageState[]): ViewStageState[] {
  return stageStates.map((state) => ({
    name: stageDisplayName(state.stage),
    status: STAGE_STATUS_VIEW[state.status] ?? "pending",
  }));
}

/**
 * JobDetail → JobHeaderView (results.md B3: display name, status, detail
 * level, created time, retention note).
 */
export function jobHeaderView(detail: JobDetail): JobHeaderView {
  return {
    id: detail.id,
    displayName: detail.displayName,
    status: detail.status as JobStatusView,
    detailLevel: detail.detailLevel as DetailLevel as JobHeaderView["detailLevel"],
    createdAt: detail.createdAt,
    expiresAt: detail.expiresAt,
    retentionNote: detail.retentionNote,
  };
}

/** Seconds from job start to its last update (or completion). */
export function elapsedSeconds(detail: JobDetail): number {
  const start = new Date(detail.createdAt).getTime();
  const end = new Date(detail.completedAt ?? detail.updatedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.round(((end - start) / 1000) * 10) / 10;
}

/** The loose AGGREGATING timeline entry shape stored on Job.timeline. */
interface RawTimelineEntry {
  start?: unknown;
  end?: unknown;
  title?: unknown;
  summary?: unknown;
}

function toTimelineEntry(raw: RawTimelineEntry): TimelineEntryView {
  return {
    start: typeof raw.start === "number" ? raw.start : 0,
    end: typeof raw.end === "number" ? raw.end : 0,
    title: typeof raw.title === "string" ? raw.title : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : "",
  };
}

/** Timeline entries persisted on the job row (may be PARTIAL output). */
export function timelineEntriesView(raw: unknown): TimelineEntryView[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is RawTimelineEntry => {
      return (
        typeof entry === "object" &&
        entry !== null &&
        "start" in entry &&
        "end" in entry
      );
    })
    .map(toTimelineEntry);
}

/**
 * All per-job collections the results shell renders, loaded for terminal
 * jobs (COMPLETED/PARTIAL). `markdown`/`json` come from ProcessingResult
 * and are null when GENERATING_CONTEXT never ran (a PARTIAL job whose
 * failed stage predates it).
 */
export interface JobResultData {
  transcript: TranscriptSegmentView[];
  observations: VisualObservationView[];
  ocr: OcrEntryView[];
  timeline: TimelineEntryView[];
  markdown: string | null;
  json: unknown | null;
  formatVersion: number | null;
}

/** Structured-result metadata folded into the composed JSON envelope. */
export interface ResultMetadata {
  id: string;
  displayName: string;
  sourceName: string;
  detailLevel: JobHeaderView["detailLevel"];
  status: "COMPLETED" | "PARTIAL";
  formatVersion: number;
  durationSec?: number;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
  expiresAt: string;
}

/**
 * AnalysisResultView for the results shell. When GENERATING_CONTEXT
 * produced no ProcessingResult (PARTIAL before context), markdown is ""
 * and the shell shows its "context still being generated" empty state
 * while transcript/observations/OCR/timeline stay viewable (jobs.md B4).
 */
export function buildResultView(
  detail: JobDetail,
  data: JobResultData,
): AnalysisResultView {
  const metadata: ResultMetadata = {
    id: detail.id,
    displayName: detail.displayName,
    sourceName: detail.displayName,
    detailLevel: detail.detailLevel,
    status: detail.status === "COMPLETED" ? "COMPLETED" : "PARTIAL",
    formatVersion: data.formatVersion ?? 1,
    ...(detail.source?.durationSec !== undefined
      ? { durationSec: detail.source.durationSec }
      : {}),
    createdAt: detail.createdAt,
    completedAt: detail.completedAt,
    updatedAt: detail.updatedAt,
    expiresAt: detail.expiresAt,
  };

  const json =
    data.json ??
    ({
      formatVersion: metadata.formatVersion,
      metadata,
      markdown: data.markdown ?? "",
      transcript: data.transcript,
      observations: data.observations,
      ocr: data.ocr,
      timeline: data.timeline,
    } satisfies Record<string, unknown>);

  return {
    formatVersion: metadata.formatVersion,
    markdown: data.markdown ?? "",
    json,
    transcript: data.transcript,
    observations: data.observations,
    ocr: data.ocr,
    timeline: data.timeline,
  };
}
