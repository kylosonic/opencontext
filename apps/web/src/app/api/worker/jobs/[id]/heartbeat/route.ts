import { NextResponse } from "next/server";
import { WorkerHeartbeatRequestSchema } from "@kylosonic/opencontext-schemas";
import { applyHeartbeat } from "@/server/worker";
import { jobToDetail } from "@/server/jobs";
import {
  checkClaim,
  enforceRateLimit,
  errorResponse,
  readJsonBody,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";

export const runtime = "nodejs";

/** POST /api/worker/jobs/[id]/heartbeat — renew a claimed job's lease. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const workerId = workerIdOf(request);

    const body = await readJsonBody(request, 32 * 1024);
    if (!body.ok) {
      return errorResponse("VALIDATION_ERROR", "Request body must be JSON");
    }
    const parsed = WorkerHeartbeatRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Invalid heartbeat payload");
    }

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }
    const limited = await enforceRateLimit(
      `worker-heartbeat:${workerId}`,
      RATE_LIMITS.workerHeartbeat.limit,
      RATE_LIMITS.workerHeartbeat.windowMs,
    );
    if (limited) return limited;

    const updated = await applyHeartbeat(claim.job);
    return NextResponse.json(jobToDetail(updated));
  });
}
