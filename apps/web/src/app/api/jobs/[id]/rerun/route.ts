import { z } from "zod";
import { DetailLevelSchema } from "@kylosonic/opencontext-schemas";
import { withErrorHandling } from "@/server/api-helpers";
import { rerunJob } from "@/server/jobs";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const RerunJobSchema = z
  .object({ detailLevel: DetailLevelSchema })
  .strict();

/**
 * POST /api/jobs/[id]/rerun — clone a terminal job's source media into a
 * fresh QUEUED job at the requested detail level.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "job-rerun",
      RATE_LIMITS.jobRerun,
      "Job re-runs",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      RerunJobSchema,
      authState.limit,
      "Select a valid detail level (LOW, MEDIUM, or HIGH)",
      4_096,
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await rerunJob(id, authState.userId, parsed.data.detailLevel);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Job not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to re-run this job",
        authState.limit,
      );
    }
    if (result.kind === "NOT_READY") {
      return errorWithLimit(
        "RETRY_NOT_ALLOWED",
        "Wait until the current job finishes before re-running at a new detail level",
        authState.limit,
      );
    }
    if (result.kind === "NO_SOURCE") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Source media is no longer available to re-run this job",
        authState.limit,
      );
    }
    return jsonWithLimit(result.job, authState.limit, 201);
  });
}
