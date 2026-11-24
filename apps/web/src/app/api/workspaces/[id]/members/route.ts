import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  errorResponse,
  rateLimitDeniedResponse,
  readJsonBody,
  withErrorHandling,
} from "@/server/api-helpers";
import {
  addWorkspaceMember,
  listWorkspaceMembers,
  WORKSPACE_ROLES,
} from "@/server/workspaces";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AddMemberSchema = z
  .object({
    identifier: z.string().trim().min(1).max(255),
    role: z.enum(WORKSPACE_ROLES).default("MEMBER"),
  })
  .strict();

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) return errorResponse("UNAUTHORIZED", "Sign in required");
    const limit = await consumeRateLimit(
      `workspace-members-read:${session.user.id}`,
      RATE_LIMITS.jobsRead.limit,
      RATE_LIMITS.jobsRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Team members");
    }
    const { id } = await context.params;
    const members = await listWorkspaceMembers(id, session.user.id);
    if (!members) return errorResponse("FORBIDDEN", "You don't have access to this team");
    return applyRateLimitHeaders(
      NextResponse.json(
        members.map((member) => ({
          userId: member.user.id,
          name: member.user.name,
          // Do not expose other members' private emails to teammates who may
          // have added them solely via a public GitHub login.
          email: member.user.id === session.user.id ? member.user.email : null,
          githubLogin: member.user.githubLogin,
          role: member.role,
        })),
      ),
      limit,
    );
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) return errorResponse("UNAUTHORIZED", "Sign in required");
    const limit = await consumeRateLimit(
      `workspace-member-add:${session.user.id}`,
      RATE_LIMITS.workspaceMember.limit,
      RATE_LIMITS.workspaceMember.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Membership changes");
    }
    const body = await readJsonBody(request, 8_192);
    if (!body.ok) return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    const parsed = AddMemberSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Enter an email or GitHub login");
    }
    const { id } = await context.params;
    const result = await addWorkspaceMember(
      id,
      session.user.id,
      parsed.data.identifier,
      parsed.data.role,
    );
    if (result.kind === "NOT_FOUND") return errorResponse("NOT_FOUND", "Team not found");
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "Only team owners and admins can add members");
    }
    if (result.kind === "USER_NOT_FOUND") {
      return errorResponse("NOT_FOUND", "That person has not signed in to OpenContext yet");
    }
    if (result.kind === "ALREADY_MEMBER") {
      return errorResponse("VALIDATION_ERROR", "That person is already a team member");
    }
    const { user } = result;
    return applyRateLimitHeaders(
      NextResponse.json({ userId: user.id, role: parsed.data.role }, { status: 201 }),
      limit,
    );
  });
}
