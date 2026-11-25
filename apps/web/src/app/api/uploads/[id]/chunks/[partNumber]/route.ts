import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import { MAX_MULTIPART_CHUNK_BYTES, storeUploadChunk } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; partNumber: string }> };

/** PUT /api/uploads/[id]/chunks/[partNumber] — upload one numbered chunk. */
export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-chunk:${session.user.id}`,
      RATE_LIMITS.uploadChunk.limit,
      RATE_LIMITS.uploadChunk.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Chunk upload rate limiting is temporarily unavailable"
            : `Upload rate limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }

    const { id, partNumber: rawPart } = await context.params;
    const partNumber = Number.parseInt(rawPart, 10);
    if (!/^\d+$/.test(rawPart) || !Number.isSafeInteger(partNumber) || partNumber < 1) {
      return errorResponse("VALIDATION_ERROR", "Part number must be a positive integer");
    }

    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const length = Number.parseInt(declaredLength, 10);
      if (Number.isFinite(length) && length > MAX_MULTIPART_CHUNK_BYTES) {
        return errorResponse("FILE_TOO_LARGE", "Uploaded part exceeds maximum chunk size");
      }
    }

    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_MULTIPART_CHUNK_BYTES) {
      return errorResponse("FILE_TOO_LARGE", "Uploaded part exceeds maximum chunk size");
    }

    const result = await storeUploadChunk(
      id,
      session.user.id,
      partNumber,
      new Uint8Array(buffer),
    );
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
      case "INVALID_PART":
        return errorResponse("VALIDATION_ERROR", result.message);
      case "OK":
        return applyRateLimitHeaders(
          NextResponse.json({
            partNumber: result.partNumber,
            etag: result.etag,
            sizeBytes: result.sizeBytes,
            uploadedPartsCount: result.uploadedPartsCount,
            totalParts: result.totalParts,
          }),
          limit,
        );
    }
  });
}
