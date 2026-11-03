import { NextResponse } from "next/server";
import { WorkerFailRequestSchema } from "@opencontext/schemas";
import { failJob } from "@/server/queue";
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
 * POST /api/worker/jobs/[id]/fail — worker-reported failure. Body:
 * { stage, error, failureKind, retryable }.
 * Server normalization (blueprint §2):
 * - PERMANENT → terminal: PARTIAL when any stage SUCCEEDED (jobs.md B4),
 *   otherwise FAILED. PERMANENT never offers retry (B6).
 * - TRANSIENT + retryable within budget → invisible requeue with backoff
 *   (B7); budget exhausted → terminal, manual retry stays available (B5).
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
    const parsed = WorkerFailRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Invalid fail payload");
    }

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }

    const result = await failJob(id, workerId ?? "", parsed.data);
    if (result.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }
    return NextResponse.json(jobToDetail(result.job));
  });
}
