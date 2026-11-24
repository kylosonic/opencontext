import { auth } from "@/auth";
import {
  errorResponse,
  rateLimitDeniedResponse,
  withErrorHandling,
} from "@/server/api-helpers";
import {
  buildSourceStreamResponse,
  getJob,
  resolveSourceAsset,
} from "@/server/jobs";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/jobs/[id]/source — owner-authenticated still/audio preview.
 * Videos use direct object-storage playback.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `source-read:${session.user.id}`,
      RATE_LIMITS.sourceRead.limit,
      RATE_LIMITS.sourceRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Source preview");
    }

    const { id } = await context.params;
    const result = await getJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }

    const asset = resolveSourceAsset(
      result.job.source,
      new URL(request.url).searchParams.get("asset"),
      { allowVideo: false },
    );
    if (!asset) {
      return errorResponse("NOT_FOUND", "Source preview not found");
    }
    const response = await buildSourceStreamResponse(asset, {
      pdfFilenameDisposition: true,
    });
    if (!response) {
      return errorResponse("NOT_FOUND", "Source preview not found");
    }
    return applyRateLimitHeaders(response, limit);
  });
}
