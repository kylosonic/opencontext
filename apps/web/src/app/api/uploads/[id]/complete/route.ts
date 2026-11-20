import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { jobToSummary } from "@/server/jobs";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import { completeUpload } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/uploads/[id]/complete — verify the object and create the job. */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-complete:${session.user.id}`,
      RATE_LIMITS.uploadComplete.limit,
      RATE_LIMITS.uploadComplete.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Upload completion is temporarily unavailable — try again shortly"
            : `Upload completion limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }

    const { id } = await context.params;
    const result = await completeUpload(id, session.user.id);
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "Upload intent not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to this upload");
      case "EXPIRED":
        return errorResponse("UPLOAD_EXPIRED", "Upload intent has expired");
      case "INCOMPLETE":
        return errorResponse(
          "UPLOAD_INCOMPLETE",
          "The uploaded object is missing or does not match the declared file",
        );
      case "INVALID_CONTENT":
        return errorResponse("VALIDATION_ERROR", result.message);
      case "OK": {
        const response = NextResponse.json(jobToSummary(result.job), { status: 201 });
        return applyRateLimitHeaders(response, limit);
      }
    }
  });
}
