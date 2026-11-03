import { STAGE_WEIGHTS, type StageState } from "@opencontext/schemas";

/**
 * Overall job progress derived from stageStates using the blueprint
 * stage weights (20/25/35/10/10). SUCCEEDED/SKIPPED stages contribute
 * their full weight; a RUNNING stage contributes its intra-stage
 * fraction (worker-reported 0–100).
 */
export function computeProgress(stageStates: StageState[]): number {
  let total = 0;
  for (const state of stageStates) {
    const weight = STAGE_WEIGHTS[state.stage] ?? 0;
    if (state.status === "SUCCEEDED" || state.status === "SKIPPED") {
      total += weight;
    } else if (state.status === "RUNNING") {
      const fraction = Math.min(100, Math.max(0, state.progress ?? 0)) / 100;
      total += weight * fraction;
    }
  }
  return Math.min(100, Math.max(0, Math.round(total)));
}

/** The initial stageStates array written on job creation. */
export function initialStageStates(): StageState[] {
  return (Object.keys(STAGE_WEIGHTS) as (keyof typeof STAGE_WEIGHTS)[]).map((stage) => ({
    stage,
    status: "NOT_STARTED",
    attempt: 0,
    progress: 0,
  }));
}
