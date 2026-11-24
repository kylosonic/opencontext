import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { DetailLevelSchema } from "@kylosonic/opencontext-schemas";
import { errorResponse, readJsonBody, withErrorHandling } from "@/server/api-helpers";
import { importRemoteUrl, RemoteImportError } from "@/server/imports/remote";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const UrlImportSchema = z
  .object({
    url: z.string().trim().url().max(8_192),
    detailLevel: DetailLevelSchema.default("MEDIUM"),
    workspaceId: z.string().min(1).max(128).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) return errorResponse("UNAUTHORIZED", "Sign in required");
    const limit = await consumeRateLimit(
      `url-import:${session.user.id}`,
      RATE_LIMITS.urlImport.limit,
      RATE_LIMITS.urlImport.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "URL import is temporarily unavailable"
            : "URL import limit reached — try again later",
        ),
        limit,
      );
    }
    const body = await readJsonBody(request, 16_384);
    if (!body.ok) return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    const parsed = UrlImportSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Enter a public HTTP or HTTPS media URL");
    }
    try {
      const result = await importRemoteUrl({
        userId: session.user.id,
        url: parsed.data.url,
        detailLevel: parsed.data.detailLevel,
        ...(parsed.data.workspaceId ? { workspaceId: parsed.data.workspaceId } : {}),
      });
      return applyRateLimitHeaders(
        NextResponse.json({ id: result.jobId }, { status: 201 }),
        limit,
      );
    } catch (error) {
      if (!(error instanceof RemoteImportError)) throw error;
      const response = errorResponse(
        error.code === "TOO_LARGE" ||
          error.code === "UNSUPPORTED" ||
          error.code === "INVALID_URL" ||
          error.code === "VALIDATION_ERROR"
          ? "VALIDATION_ERROR"
          : error.code === "UNSAFE_URL" || error.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : "INTERNAL",
        error.message,
      );
      return applyRateLimitHeaders(response, limit);
    }
  });
}
