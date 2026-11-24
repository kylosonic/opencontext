import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
} from "@/server/security/rate-limit";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { getSharedJob } from "@/server/jobs";
import { storage } from "@/server/storage";

export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

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
    if (!shared?.job.source?.key) {
      return errorResponse("NOT_FOUND", "Shared source not found");
    }
    const requestedIndex = Number(new URL(request.url).searchParams.get("asset") ?? "0");
    const assets = shared.job.source.assets ?? [];
    const hasValidIndex =
      Number.isInteger(requestedIndex) &&
      requestedIndex >= 0 &&
      requestedIndex < assets.length;
    if (requestedIndex !== 0 && !hasValidIndex) {
      return errorResponse("NOT_FOUND", "Shared source not found");
    }
    const asset = hasValidIndex ? assets[requestedIndex] : assets[0];
    const extension = (asset?.ext ?? shared.job.source.ext).toLowerCase();
    const contentType = CONTENT_TYPE[extension];
    const key = asset?.key ?? shared.job.source.key;
    if (!contentType) return errorResponse("NOT_FOUND", "Shared source not found");
    const head = await storage.head(key);
    const body = await storage.stream(key);
    if (!body) return errorResponse("NOT_FOUND", "Shared source not found");
    return applyRateLimitHeaders(
      new Response(body, {
        headers: {
          "Content-Type": contentType,
          ...(head && head.sizeBytes > 0
            ? { "Content-Length": String(head.sizeBytes) }
            : {}),
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          ...(contentType === "application/pdf"
            ? { "Content-Security-Policy": "frame-ancestors 'self'" }
            : {}),
        },
      }),
      limit,
    );
  });
}
