import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { retryJob } from "@/server/jobs";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/jobs/[id]/retry — manual retry (jobs.md B5). Only PARTIAL
 * jobs, or FAILED jobs with failureKind TRANSIENT, may be retried
 * (B6: PERMANENT failures cannot be helped by re-running). Failed and
 * not-yet-run stages reset; SUCCEEDED/SKIPPED stages and their stored
 * results are reused. Everything else → 409 RETRY_NOT_ALLOWED.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const { id } = await context.params;
    const limit = await consumeRateLimit(
      `job-retry:${session.user.id}`,
      RATE_LIMITS.jobRetry.limit,
      RATE_LIMITS.jobRetry.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Job retry is temporarily unavailable — try again shortly"
            : `Retry limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }
    const result = await retryJob(id, session.user.id);
    if (result.kind === "RETRY_NOT_ALLOWED") {
      if (result.reason === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "Job not found");
      }
      if (result.reason === "FORBIDDEN") {
        return errorResponse("FORBIDDEN", "You don't have access to this job");
      }
      return errorResponse("RETRY_NOT_ALLOWED", result.reason);
    }
    return applyRateLimitHeaders(NextResponse.json(result.job), limit);
  });
}
