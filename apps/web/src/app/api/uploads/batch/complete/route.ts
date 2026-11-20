import { NextResponse } from "next/server";
import { CompleteUploadBatchRequestSchema } from "@kylosonic/opencontext-schemas";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { jobToSummary } from "@/server/jobs";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import { completeUploadBatch } from "@/server/uploads";

export const runtime = "nodejs";

/** POST /api/uploads/batch/complete — commit an ordered image-set job. */
export async function POST(request: Request): Promise<Response> {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CompleteUploadBatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Image-set upload data is invalid");
    }

    const result = await completeUploadBatch(
      parsed.data.uploadIds,
      session.user.id,
      parsed.data.detailLevel,
    );
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "One or more uploads were not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to these uploads");
      case "EXPIRED":
        return errorResponse("UPLOAD_EXPIRED", "One or more uploads have expired");
      case "INCOMPLETE":
        return errorResponse(
          "UPLOAD_INCOMPLETE",
          "One or more uploaded objects are missing or incomplete",
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
