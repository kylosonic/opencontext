import { NextResponse } from "next/server";
import { WorkerClaimRequestSchema } from "@opencontext/schemas";
import { claimJob } from "@/server/queue";
import { jobToDetail } from "@/server/jobs";
import { getWorkerSourceInfo } from "@/server/worker";
import { errorResponse, verifyWorkerToken, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * POST /api/worker/jobs/claim — atomic lease claim (ADR-0001).
 * Body: { workerId }. 200 → { job, source }; 204 → queue idle.
 */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("VALIDATION_ERROR", "Request body must be JSON");
    }
    const parsed = WorkerClaimRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Missing or invalid `workerId`");
    }

    const job = await claimJob({ workerId: parsed.data.workerId });
    if (!job) {
      return new NextResponse(null, { status: 204 });
    }

    const source = await getWorkerSourceInfo(job);
    return NextResponse.json({ job: jobToDetail(job), source });
  });
}
