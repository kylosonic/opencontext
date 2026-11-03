import demoResultJson from "./demo-result.json";
import type { DemoResult } from "./types";

export type {
  DemoCertainty,
  DemoMetadata,
  DemoObservation,
  DemoOcrEntry,
  DemoResult,
  DemoStageState,
  DemoTimelineEntry,
  DemoTranscriptSegment,
} from "./types";

export {
  computeDemoProgress,
  DEMO_STAGES,
  DEMO_TOTAL_SEC,
} from "./progress";

export type {
  DemoProgress,
  DemoProgressStage,
  DemoStageStatus,
} from "./progress";

/**
 * The complete, deterministic, pre-authored demo result. Served verbatim by
 * GET /api/demo/result — no database, environment, or credentials involved.
 */
export const DEMO_RESULT: DemoResult = demoResultJson as unknown as DemoResult;
