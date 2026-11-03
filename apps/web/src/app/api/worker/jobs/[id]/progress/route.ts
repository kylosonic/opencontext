import { NextResponse } from "next/server";
import { WorkerProgressRequestSchema } from "@opencontext/schemas";
import { applyProgress } from "@/server/worker";
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
 * POST /api/worker/jobs/[id]/progress — report stage progress.
 * Body: { stage, stageStatus, progress, message? }.
 * Updates stageStates, recomputes overall progress from stage weights,
 * renews the lease. Idempotent.
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
    const parsed = WorkerProgressRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Invalid progress payload");
    }

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }

    const updated = await applyProgress(claim.job, parsed.data);
    return NextResponse.json(jobToDetail(updated));
  });
}
