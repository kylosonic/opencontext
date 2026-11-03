import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteJob, getJob } from "@/server/jobs";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

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
    const { id } = await context.params;
    const result = await getJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return NextResponse.json(result.job);
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
    const { id } = await context.params;
    const result = await deleteJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    return new NextResponse(null, { status: 204 });
  });
}
