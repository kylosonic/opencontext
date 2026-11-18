import { NextResponse } from "next/server";
import { WorkerClaimRequestSchema } from "@kylosonic/opencontext-schemas";
import { errorResponse, verifyWorkerToken, withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";

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
    const parsed = WorkerClaimRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Missing or invalid `workerId`");
    }
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
