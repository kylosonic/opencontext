import { NextResponse } from "next/server";
import { WorkerStageResultRequestSchema } from "@opencontext/schemas";
import { applyStageResult } from "@/server/worker";
import { jobToDetail } from "@/server/jobs";
import {
  checkClaim,
  errorResponse,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * POST /api/worker/jobs/[id]/stage-result — idempotent upsert of one
 * stage's result (blueprint §4 resume idempotency).
 * Body: { stage, outcome: SUCCEEDED|FAILED|SKIPPED, attempt, error?,
 * reason?, data? }.
 *   EXTRACTING          data = probe metadata (duration, size, audio…)
 *   TRANSCRIBING        data = { segments }
 *   ANALYZING           data = { observations, ocr }
 *   AGGREGATING         data = { timeline }
 *   GENERATING_CONTEXT  data = { markdown, json } → ProcessingResult upsert
 * SKIPPED carries `reason` (e.g. NO_AUDIO, results B4 — not an error).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const workerId = workerIdOf(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("VALIDATION_ERROR", "Request body must be JSON");
    }
    const parsed = WorkerStageResultRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Invalid stage-result payload");
    }

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }

    try {
      const updated = await applyStageResult(claim.job, parsed.data);
      return NextResponse.json(jobToDetail(updated));
    } catch (error) {
      if ((error as Error).name === "ZodStageDataError") {
        return errorResponse(
          "VALIDATION_ERROR",
          (error as Error).message,
          parsed.data.stage,
        );
      }
      throw error;
    }
  });
}
