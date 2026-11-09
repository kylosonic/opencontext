import type { ReactNode } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RESULTS VIEWER — SHARED VIEW CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `ResultViewer` is deliberately decoupled from API and transport details.
 * The demo and authenticated job pages map their data onto these props.
 *
 * Authenticated job mapping:
 *   GET /api/jobs/[id]            → `job`  (id, displayName, status,
 *                                  detailLevel, createdAt, expiresAt,
 *                                  retention text) and `stages`
 *                                  (from the `stageStates` JSON column:
 *                                  stage → display name, status →
 *                                  StageStatus; map Prisma enum
 *                                  StageStatus { NOT_STARTED, RUNNING,
 *                                  SUCCEEDED, FAILED, SKIPPED } to
 *                                  { pending, running, done, failed,
 *                                  skipped }).
 *   GET job result payload        → `result` (markdown + full JSON +
 *                                  transcript / observations / ocr /
 *                                  timeline collections).
 *   `<video>` element             → `videoSlot`; timeline clicks arrive via
 *                                  `onSeek(timestampSec)` — wire it to
 *                                  `video.currentTime = t; video.play()`.
 *
 * Demo usage: pass the GET /api/demo/result payload through the same fields
 * with `demo={true}` for the persistent "Demo Analysis" badges.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type StageStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export interface StageState {
  /** Display-ready name, e.g. "Analyzing visual frames". */
  name: string;
  status: StageStatus;
}

export type Certainty = "OBSERVED" | "INFERRED" | "UNCERTAIN";

export type JobStatusView =
  | "QUEUED"
  | "DOWNLOADING"
  | "EXTRACTING"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "AGGREGATING"
  | "GENERATING_CONTEXT"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export interface JobHeaderView {
  id: string;
  displayName: string;
  status: JobStatusView;
  detailLevel: "LOW" | "MEDIUM" | "HIGH";
  /** False when the probed source had no audio stream. */
  audioPresent?: boolean | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; hidden when unknown. */
  expiresAt?: string;
  /** Human retention sentence; hidden when unknown. */
  retentionNote?: string;
}

export interface TranscriptSegmentView {
  start: number;
  end: number;
  text: string;
}

export interface DesignObservationsView {
  layout?: string;
  typography?: string;
  spacing?: string;
  color?: string;
}

export interface VisualObservationView {
  timestampSec: number;
  certainty: Certainty;
  sceneTitle?: string;
  visualDescription?: string;
  uiElements?: string[];
  visibleText?: string[];
  /** Always rendered as inferred (per pipeline rules). */
  interactions?: string[];
  layoutDescription?: string;
  designObservations?: DesignObservationsView;
  importantChanges?: string[];
}

export interface OcrEntryView {
  timestampSec: number;
  text: string;
  /** 0–1; hidden when unknown. */
  confidence?: number;
}

export interface TimelineEntryView {
  start: number;
  end: number;
  title?: string;
  summary: string;
}

export interface AnalysisResultView {
  formatVersion: number;
  /** The full developer-context document (copy/download source of truth). */
  markdown: string;
  /** The complete structured result object (Download JSON source). */
  json: unknown;
  transcript: TranscriptSegmentView[];
  observations: VisualObservationView[];
  ocr: OcrEntryView[];
  timeline: TimelineEntryView[];
}

export interface ResultViewerProps {
  /** Job header card data. */
  job: JobHeaderView;
  /** Structured result. */
  result: AnalysisResultView;
  /** Stage checklist rows. Omit for completed jobs without stage history. */
  stages?: StageState[];
  /** 0–100; rendered only when `stages` is present. */
  progress?: number;
  /** Seconds since job start; rendered with the checklist. */
  elapsedSec?: number;
  /** True while the job is actively processing (drives "Analyzing…" states). */
  active?: boolean;
  /** Persistent "Demo Analysis" badges (job header + tab strip). */
  demo?: boolean;
  /** Timeline and evidence reference click → seek to a source timestamp. */
  onSeek?: (timestampSec: number) => void;
  /** A real `<video>` element. Omitted → honest placeholder panel. */
  videoSlot?: ReactNode;
  /** Currently selected timestamp, echoed in the placeholder (demo wiring). */
  selectedTimestamp?: number | null;
}
