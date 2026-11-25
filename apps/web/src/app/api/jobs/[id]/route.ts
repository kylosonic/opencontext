import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { deleteJob, getJob, renameJob } from "@/server/jobs";
import {
  errorResponse,
  rateLimitDeniedResponse,
  withErrorHandling,
} from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const RenameJobSchema = z
  .object({ displayName: z.string().trim().min(1).max(200) })
  .strict();

/**
 * GET /api/jobs/[id] — full job state (owner only; identity.md B4).
 * Non-owner → 403; deleted → 404 (jobs.md B10); anonymous → 401
 * (middleware).
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `job-read:${session.user.id}`,
      RATE_LIMITS.jobRead.limit,
      RATE_LIMITS.jobRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Job read");
    }
    const { id } = await context.params;
    const result = await getJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return applyRateLimitHeaders(NextResponse.json(result.job), limit);
  });
}

/** PATCH /api/jobs/[id] — rename a job display name (owner or team OWNER/ADMIN). */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "job-update",
      RATE_LIMITS.jobUpdate,
      "Job updates",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      RenameJobSchema,
      authState.limit,
      "Job name must be 1–200 characters",
      4_096,
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await renameJob(id, authState.userId, parsed.data.displayName);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Job not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to rename this job",
        authState.limit,
      );
    }
    if (result.kind === "INVALID") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Job name must be 1–200 characters",
        authState.limit,
      );
    }
    return jsonWithLimit(result.job, authState.limit);
  });
}

/**
 * DELETE /api/jobs/[id] — owner only; removes stored objects then the
 * rows (jobs.md B10). 204 on success.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `job-delete:${session.user.id}`,
      RATE_LIMITS.jobDelete.limit,
      RATE_LIMITS.jobDelete.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Job deletion");
    }
    const { id } = await context.params;
    const result = await deleteJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return applyRateLimitHeaders(new NextResponse(null, { status: 204 }), limit);
  });
}
