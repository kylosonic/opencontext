import { NextResponse } from "next/server";
import { getWorkerSourceInfo } from "@/server/worker";
import {
  checkClaim,
  errorResponse,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * GET /api/worker/jobs/[id]/source — fetch instructions for the source
 * media: `{uri, provider, sizeBytes, filename}`. S3 → presigned URL;
 * local → relative path served by GET /api/worker/media/[key] (the
 * worker client prepends its app base URL and sends the Bearer token).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const claim = await checkClaim(id, workerIdOf(request));
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }
    const source = await getWorkerSourceInfo(claim.job);
    return NextResponse.json(source);
  });
}
