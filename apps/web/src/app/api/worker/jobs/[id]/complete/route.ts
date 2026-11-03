import { NextResponse } from "next/server";
import { completeJob } from "@/server/queue";
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
 * POST /api/worker/jobs/[id]/complete — all stages terminal → COMPLETED,
 * completedAt set, progress 100, lease released. Idempotent.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const workerId = workerIdOf(request);

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }

    const result = await completeJob(id, workerId ?? "");
    if (result.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }
    if (result.kind === "STAGES_NOT_TERMINAL") {
      return errorResponse(
        "VALIDATION_ERROR",
        "Cannot complete: not all stages are terminal",
      );
    }
    return NextResponse.json(jobToDetail(result.job));
  });
}
