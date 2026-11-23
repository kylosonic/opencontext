import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import { cancelUpload } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/uploads/[id] - abort an upload and remove its temporary object. */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-cancel:${session.user.id}`,
      RATE_LIMITS.uploadCancel.limit,
      RATE_LIMITS.uploadCancel.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Upload cancellation is temporarily unavailable — try again shortly"
            : `Upload cancellation limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }

    const { id } = await context.params;
    const result = await cancelUpload(id, session.user.id);
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "Upload intent not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to this upload");
      case "IN_PROGRESS":
        return errorResponse(
          "UPLOAD_INCOMPLETE",
          "This upload cannot be cancelled while completion is in progress",
        );
      case "OK": {
        const response = new NextResponse(null, { status: 204 });
        return applyRateLimitHeaders(response, limit);
      }
    }
  });
}
