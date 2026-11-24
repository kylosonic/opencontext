import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  errorResponse,
  rateLimitDeniedResponse,
  readJsonBody,
  withErrorHandling,
} from "@/server/api-helpers";
import { createWorkspace, listWorkspaces } from "@/server/workspaces";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

const CreateWorkspaceSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) return errorResponse("UNAUTHORIZED", "Sign in required");
    const limit = await consumeRateLimit(
      `workspace-read:${session.user.id}`,
      RATE_LIMITS.jobsRead.limit,
      RATE_LIMITS.jobsRead.windowMs,
    );
    if (!limit.allowed) return rateLimitDeniedResponse(limit, "Team list");
    return applyRateLimitHeaders(
      NextResponse.json(await listWorkspaces(session.user.id)),
      limit,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) return errorResponse("UNAUTHORIZED", "Sign in required");
    const limit = await consumeRateLimit(
      `workspace-create:${session.user.id}`,
      RATE_LIMITS.workspaceCreate.limit,
      RATE_LIMITS.workspaceCreate.windowMs,
    );
    if (!limit.allowed) return rateLimitDeniedResponse(limit, "Team creation");
    const body = await readJsonBody(request, 4_096);
    if (!body.ok) return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    const parsed = CreateWorkspaceSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Team names must be 1–80 characters");
    }
    const result = await createWorkspace(session.user.id, parsed.data.name);
    if (result.kind === "INVALID") {
      return errorResponse("VALIDATION_ERROR", "Team names must be 1–80 characters");
    }
    return applyRateLimitHeaders(NextResponse.json({
      id: result.workspace.id,
      name: result.workspace.name,
      role: "OWNER",
      memberCount: result.workspace._count.members,
      jobCount: result.workspace._count.jobs,
    }, { status: 201 }), limit);
  });
}
