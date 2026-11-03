/**
 * Types for the pre-authored demo result and the scripted progress feed.
 *
 * The demo result mirrors the shape a real completed job's structured result
 * will expose through the jobs API (slices 3–4): metadata, transcript
 * segments, visual observations with certainty, OCR entries, aggregated
 * timeline entries, evidence references, and the full Markdown handoff.
 */

export type DemoCertainty = "OBSERVED" | "INFERRED" | "UNCERTAIN";

export interface DemoMetadata {
  id: string;
  displayName: string;
  sourceName: string;
  durationSec: number;
  detailLevel: "LOW" | "MEDIUM" | "HIGH";
  demo: true;
  status: "COMPLETED";
  formatVersion: number;
  createdAt: string;
  completedAt: string;
  expiresAt: string;
  retentionNote: string;
}

export interface DemoStageState {
  name: string;
  status: "done";
}

export interface DemoTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface DemoDesignObservations {
  layout?: string;
  typography?: string;
  spacing?: string;
  color?: string;
}

export interface DemoObservation {
  timestampSec: number;
  certainty: DemoCertainty;
  sceneTitle: string;
  visualDescription: string;
  uiElements: string[];
  visibleText: string[];
  interactions: string[];
  layoutDescription?: string;
  designObservations?: DemoDesignObservations;
  importantChanges: string[];
}

export interface DemoOcrEntry {
  timestampSec: number;
  text: string;
  confidence: number;
}

export interface DemoTimelineEntry {
  start: number;
  end: number;
  title: string;
  summary: string;
}

export interface DemoEvidenceRecord {
  id: number;
  kind: "TRANSCRIPT" | "VISUAL" | "OCR";
  timestampSec: number;
  endSec?: number;
  certainty: DemoCertainty;
  text: string;
  source: { collection: string; index: number };
}

export interface DemoResult {
  metadata: DemoMetadata;
  stages: DemoStageState[];
  transcript: DemoTranscriptSegment[];
  observations: DemoObservation[];
  ocr: DemoOcrEntry[];
  timeline: DemoTimelineEntry[];
  evidenceVersion?: number;
  evidence?: DemoEvidenceRecord[];
  markdown: string;
}
