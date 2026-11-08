import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { retryJob } from "@/server/jobs";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { consumeRateLimit } from "@/server/security/rate-limit";

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
    const limit = await consumeRateLimit(`job-retry:${session.user.id}:${id}`, 5, 60_000);
    if (!limit.allowed) {
      const response = errorResponse(
        "RATE_LIMITED",
        "Too many retry requests — wait a minute and try again",
      );
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
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
    return NextResponse.json(result.job);
  });
}
