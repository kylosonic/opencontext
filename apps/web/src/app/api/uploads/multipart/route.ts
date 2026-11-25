import { NextResponse } from "next/server";
import { z } from "zod";
import { UploadIntentRequestSchema } from "@kylosonic/opencontext-schemas";
import { auth } from "@/auth";
import { errorResponse, readJsonBody, withErrorHandling } from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import { createMultipartUploadIntent } from "@/server/uploads";

export const runtime = "nodejs";

const MultipartIntentSchema = UploadIntentRequestSchema.extend({
  chunkSizeBytes: z.number().int().positive().optional(),
}).strict();

/** POST /api/uploads/multipart — initialize a resumable chunked upload intent. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-intent:${session.user.id}`,
      RATE_LIMITS.uploadIntent.limit,
      RATE_LIMITS.uploadIntent.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Upload rate limiting is temporarily unavailable — try again shortly"
            : `Upload limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }

    const body = await readJsonBody(request, 10_000);
    if (!body.ok) {
      return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = MultipartIntentSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Multipart upload parameters are invalid");
    }

    const result = await createMultipartUploadIntent({
      userId: session.user.id,
      ...parsed.data,
    });
    if (result.kind === "INVALID") {
      return errorResponse(result.code, result.message);
    }

    return applyRateLimitHeaders(
      NextResponse.json(
        {
          uploadId: result.uploadId,
          chunkSizeBytes: result.chunkSizeBytes,
          totalParts: result.totalParts,
          expiresAt: result.expiresAt,
        },
        { status: 201 },
      ),
      limit,
    );
  });
}
