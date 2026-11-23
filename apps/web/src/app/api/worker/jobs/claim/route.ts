import { NextResponse } from "next/server";
import { WorkerClaimRequestSchema } from "@kylosonic/opencontext-schemas";
import { claimJob } from "@/server/queue";
import { jobToDetail } from "@/server/jobs";
import { getWorkerSourceInfo } from "@/server/worker";
import {
  enforceRateLimit,
  errorResponse,
  readJsonBody,
  verifyWorkerToken,
  withErrorHandling,
} from "@/server/api-helpers";
import { RATE_LIMITS, requestRateKey } from "@/server/security/rate-limit";

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

    const body = await readJsonBody(request, 32 * 1024);
    if (!body.ok) {
      return errorResponse("VALIDATION_ERROR", "Request body must be JSON");
    }
    const parsed = WorkerClaimRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Missing or invalid `workerId`");
    }
    const limited = await enforceRateLimit(
      requestRateKey(request, `worker-claim:${parsed.data.workerId}`),
      RATE_LIMITS.workerClaim.limit,
      RATE_LIMITS.workerClaim.windowMs,
    );
    if (limited) return limited;

    const job = await claimJob({ workerId: parsed.data.workerId });
    if (!job) {
      return new NextResponse(null, { status: 204 });
    }

    const source = await getWorkerSourceInfo(job);
    return NextResponse.json({ job: jobToDetail(job), source });
  });
}
