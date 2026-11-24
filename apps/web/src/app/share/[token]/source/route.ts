import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
} from "@/server/security/rate-limit";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import {
  buildSourceStreamResponse,
  getSharedJob,
  resolveSourceAsset,
} from "@/server/jobs";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const limit = await consumeRateLimit(
      requestRateKey(request, "public-share-source"),
      RATE_LIMITS.publicShareSource.limit,
      RATE_LIMITS.publicShareSource.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Shared source is temporarily unavailable"
            : "Shared source limit reached — try again shortly",
        ),
        limit,
      );
    }
    const { token } = await context.params;
    const shared = await getSharedJob(token);
    const asset = resolveSourceAsset(
      shared?.job.source,
      new URL(request.url).searchParams.get("asset"),
      { allowVideo: true },
    );
    if (!asset) {
      return errorResponse("NOT_FOUND", "Shared source not found");
    }
    const response = await buildSourceStreamResponse(asset, {
      includeContentLength: true,
    });
    if (!response) {
      return errorResponse("NOT_FOUND", "Shared source not found");
    }
    return applyRateLimitHeaders(response, limit);
  });
}
