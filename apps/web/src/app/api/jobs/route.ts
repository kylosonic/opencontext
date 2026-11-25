import { NextResponse } from "next/server";
import { z } from "zod";
import { SourceKindSchema } from "@kylosonic/opencontext-schemas";
import { auth } from "@/auth";
import { listJobs, type JobStatusFilter } from "@/server/jobs";
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

export const runtime = "nodejs";

const QuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "PARTIAL", "FAILED"]).optional(),
  workspaceId: z.string().trim().max(128).optional(),
  sourceKind: SourceKindSchema.optional(),
});

function nonEmptyParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

/**
 * GET /api/jobs — accessible personal and team jobs, newest first,
 * with optional search, status, workspace, and sourceKind filters.
 */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `jobs-read:${session.user.id}`,
      RATE_LIMITS.jobsRead.limit,
      RATE_LIMITS.jobsRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Job list");
    }
    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      q: nonEmptyParam(url, "q"),
      status: nonEmptyParam(url, "status"),
      workspaceId: nonEmptyParam(url, "workspaceId"),
      sourceKind: nonEmptyParam(url, "sourceKind"),
    });
    if (!parsed.success) {
      return applyRateLimitHeaders(
        errorResponse("VALIDATION_ERROR", "Invalid job list filter parameter"),
        limit,
      );
    }
    const jobs = await listJobs(session.user.id, {
      q: parsed.data.q,
      status: parsed.data.status as JobStatusFilter | undefined,
      workspaceId: parsed.data.workspaceId,
      sourceKind: parsed.data.sourceKind,
    });
    return applyRateLimitHeaders(NextResponse.json(jobs), limit);
  });
}
