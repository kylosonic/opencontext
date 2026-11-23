import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listJobs } from "@/server/jobs";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/jobs — the caller's own jobs, newest first.
 *
 * Uploads use POST /api/uploads, a direct object-storage PUT, and
 * POST /api/uploads/[id]/complete so large bytes never pass through the
 * Next.js request body.
 */
export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `jobs-read:${session.user.id}`,
      RATE_LIMITS.jobsRead.limit,
      RATE_LIMITS.jobsRead.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse("RATE_LIMITED", `Try again in ${limit.retryAfterSec} seconds`),
        limit,
      );
    }
    const jobs = await listJobs(session.user.id);
    return applyRateLimitHeaders(NextResponse.json(jobs), limit);
  });
}
