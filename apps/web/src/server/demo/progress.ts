/**
 * Demo progress script — a pure function of the requested elapsed time.
 *
 * The demo page advances a LOCAL clock and asks "what would a job look like
 * at elapsed=X seconds?" No server wall clock, database, or queue is
 * involved, so responses are fully deterministic and trivially testable.
 *
 * TIMING TABLE (seconds since the demo started):
 *
 *   stage                          completes at   weight
 *   ─────────────────────────────────────────────────────
 *   Media extracted                     1.5          20
 *   Transcription + vision              3.5          30
 *   Context aggregated                  5.5          25
 *   Developer context generated         7.5          25
 *   ─────────────────────────────────────────────────────
 *   Job completed (progress = 100)     8.0           —
 *
 * A stage is RUNNING from strictly after the previous stage's completion
 * (or 0 for the first) until its own completion time, and PENDING before
 * that — so at elapsed=0 every stage reports PENDING. Overall progress is
 * stage-weighted with intra-stage fractions, capped at 100.
 * Invalid (NaN) or negative elapsed values are treated as 0.
 */

export type DemoStageStatus = "pending" | "running" | "done";

export interface DemoProgressStage {
  name: string;
  status: DemoStageStatus;
}

export interface DemoProgress {
  stages: DemoProgressStage[];
  completed: boolean;
  /** 0–100 */
  progress: number;
}

interface DemoStageSpec {
  name: string;
  completesAt: number;
  weight: number;
}

export const DEMO_STAGES: readonly DemoStageSpec[] = [
  { name: "Media extracted", completesAt: 1.5, weight: 20 },
  { name: "Transcription + vision", completesAt: 3.5, weight: 30 },
  { name: "Context aggregated", completesAt: 5.5, weight: 25 },
  { name: "Developer context generated", completesAt: 7.5, weight: 25 },
];

/** Total scripted duration of the demo, in seconds. */
export const DEMO_TOTAL_SEC = 8;

export function computeDemoProgress(elapsed: number): DemoProgress {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const completed = e >= DEMO_TOTAL_SEC;

  const stages: DemoProgressStage[] = DEMO_STAGES.map((stage, index) => {
    const previousCompletesAt =
      index === 0 ? 0 : DEMO_STAGES[index - 1].completesAt;
    const status: DemoStageStatus =
      e >= stage.completesAt
        ? "done"
        : e > previousCompletesAt
          ? "running"
          : "pending";
    return { name: stage.name, status };
  });

  let weighted = 0;
  DEMO_STAGES.forEach((stage, index) => {
    const previousCompletesAt =
      index === 0 ? 0 : DEMO_STAGES[index - 1].completesAt;
    if (e >= stage.completesAt) {
      weighted += stage.weight;
    } else if (e > previousCompletesAt) {
      const fraction = Math.min(
        1,
        (e - previousCompletesAt) / (stage.completesAt - previousCompletesAt),
      );
      weighted += fraction * stage.weight;
    }
  });

  const progress = completed ? 100 : Math.min(100, Math.round(weighted));
  return { stages, completed, progress };
}
