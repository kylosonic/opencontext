import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  type RateLimitResult,
} from "@/server/security/rate-limit";
import {
  createJobShare,
  jobShareStatus,
  revokeJobShares,
} from "@/server/jobs";
import {
  errorResponse,
  rateLimitDeniedResponse,
  withErrorHandling,
} from "@/server/api-helpers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type Authenticated =
  | { kind: "DENIED"; response: Response }
  | { kind: "OK"; userId: string; id: string; limit: RateLimitResult };

async function authenticate(
  context: RouteContext,
  subject: string,
): Promise<Authenticated> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      kind: "DENIED",
      response: errorResponse("UNAUTHORIZED", "Sign in required"),
    };
  }
  const limit = await consumeRateLimit(
    `job-share:${session.user.id}`,
    RATE_LIMITS.jobRead.limit,
    RATE_LIMITS.jobRead.windowMs,
  );
  if (!limit.allowed) {
    return {
      kind: "DENIED",
      response: rateLimitDeniedResponse(limit, subject),
    };
  }
  const { id } = await context.params;
  return { kind: "OK", userId: session.user.id, id, limit };
}

function accessError(kind: "NOT_FOUND" | "FORBIDDEN"): Response {
  return kind === "NOT_FOUND"
    ? errorResponse("NOT_FOUND", "Job not found")
    : errorResponse("FORBIDDEN", "You don't have access to this job");
}

/**
 * GET /api/jobs/[id]/share — whether an unexpired public link exists.
 * Only metadata is returned; the token itself is shown once at creation.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await authenticate(context, "Share status");
    if (authState.kind !== "OK") return authState.response;
    const status = await jobShareStatus(authState.id, authState.userId);
    if (status.kind !== "OK") return accessError(status.kind);
    return applyRateLimitHeaders(
      NextResponse.json({
        active: Boolean(status.share),
        ...(status.share ? { expiresAt: status.share.expiresAt.toISOString() } : {}),
      }),
      authState.limit,
    );
  });
}

/**
 * POST /api/jobs/[id]/share — rotate and return a read-only public link.
 * Rotating revokes every previously issued link for the job.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await authenticate(context, "Share creation");
    if (authState.kind !== "OK") return authState.response;
    const result = await createJobShare(authState.id, authState.userId);
    if (result.kind === "NOT_FOUND" || result.kind === "FORBIDDEN") {
      return accessError(result.kind);
    }
    if (result.kind === "NOT_READY") {
      return errorResponse("VALIDATION_ERROR", "Finish processing before sharing this job");
    }
    return applyRateLimitHeaders(
      NextResponse.json({
        url: `/share/${result.token}`,
        expiresAt: result.share.expiresAt.toISOString(),
      }),
      authState.limit,
    );
  });
}

/** DELETE /api/jobs/[id]/share — revoke every active public link. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await authenticate(context, "Share revocation");
    if (authState.kind !== "OK") return authState.response;
    const result = await revokeJobShares(authState.id, authState.userId);
    if (result.kind !== "OK") return accessError(result.kind);
    return applyRateLimitHeaders(new NextResponse(null, { status: 204 }), authState.limit);
  });
}
