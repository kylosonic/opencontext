import { NextResponse } from "next/server";
import { auth } from "@/auth";
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
import { getUploadStatus } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/uploads/[id]/status — inspect uploaded chunks for resumable uploads. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-status:${session.user.id}`,
      RATE_LIMITS.jobsRead.limit,
      RATE_LIMITS.jobsRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Upload status");
    }

    const { id } = await context.params;
    const result = await getUploadStatus(id, session.user.id);
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "Upload intent not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to this upload");
      case "EXPIRED":
        return errorResponse("UPLOAD_EXPIRED", "Upload intent has expired");
      case "IN_PROGRESS":
        return errorResponse(
          "UPLOAD_INCOMPLETE",
          "Upload completion is already in progress",
        );
      case "NOT_MULTIPART":
        return errorResponse(
          "VALIDATION_ERROR",
          "Upload intent is not a resumable chunked upload",
        );
      case "OK":
        return applyRateLimitHeaders(NextResponse.json(result.status), limit);
    }
  });
}
