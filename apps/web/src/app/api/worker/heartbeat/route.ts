import { NextResponse } from "next/server";
import { WorkerClaimRequestSchema } from "@kylosonic/opencontext-schemas";
import {
  enforceRateLimit,
  errorResponse,
  readJsonBody,
  verifyWorkerToken,
  withErrorHandling,
} from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { RATE_LIMITS, requestRateKey } from "@/server/security/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/worker/heartbeat — a lightweight idle-loop liveness signal.
 * The row is an internal operational lease marker, not a user account.
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
      requestRateKey(request, "worker-heartbeat"),
      RATE_LIMITS.workerHeartbeat.limit,
      RATE_LIMITS.workerHeartbeat.windowMs,
    );
    if (limited) return limited;
    const key = `worker-lease:${parsed.data.workerId}`;
    const resetAt = new Date(Date.now() + 2 * 60 * 1000);
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, resetAt },
      update: { count: 1, resetAt },
    });
    return new NextResponse(null, { status: 204 });
  });
}
