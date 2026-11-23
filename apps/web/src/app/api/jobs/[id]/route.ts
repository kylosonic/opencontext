import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteJob, getJob } from "@/server/jobs";
import {
  errorResponse,
  rateLimitDeniedResponse,
  withErrorHandling,
} from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/jobs/[id] — full job state (owner only; identity.md B4).
 * Non-owner → 403; deleted → 404 (jobs.md B10); anonymous → 401
 * (middleware).
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `job-read:${session.user.id}`,
      RATE_LIMITS.jobRead.limit,
      RATE_LIMITS.jobRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Job read");
    }
    const { id } = await context.params;
    const result = await getJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return applyRateLimitHeaders(NextResponse.json(result.job), limit);
  });
}

/**
 * DELETE /api/jobs/[id] — owner only; removes stored objects then the
 * rows (jobs.md B10). 204 on success.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `job-delete:${session.user.id}`,
      RATE_LIMITS.jobDelete.limit,
      RATE_LIMITS.jobDelete.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Job deletion");
    }
    const { id } = await context.params;
    const result = await deleteJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return applyRateLimitHeaders(new NextResponse(null, { status: 204 }), limit);
  });
}
