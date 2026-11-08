import { NextResponse } from "next/server";
import { UploadIntentRequestSchema } from "@opencontext/schemas";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { createUploadIntent } from "@/server/uploads";

export const runtime = "nodejs";

/** POST /api/uploads — create a 15-minute direct-upload intent. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `upload-intent:${session.user.id}`,
      10,
      10 * 60_000,
    );
    if (!limit.allowed) {
      const response = errorResponse(
        "RATE_LIMITED",
        "Too many upload requests — wait a few minutes and try again",
      );
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 10_000) {
      return errorResponse("VALIDATION_ERROR", "Upload request is too large");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = UploadIntentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Upload intent data is invalid");
    }

    const result = await createUploadIntent({
      userId: session.user.id,
      ...parsed.data,
    });
    if (result.kind === "INVALID") {
      return errorResponse(result.code, result.message);
    }
    return NextResponse.json(
      {
        uploadId: result.uploadId,
        method: result.method,
        url: result.url,
        headers: result.headers,
        expiresAt: result.expiresAt,
      },
      { status: 201 },
    );
  });
}
