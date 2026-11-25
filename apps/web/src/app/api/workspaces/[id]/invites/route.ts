import { z } from "zod";
import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";
import {
  createWorkspaceInvite,
  INVITABLE_WORKSPACE_ROLES,
  listWorkspaceInvites,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const CreateInviteSchema = z
  .object({
    email: z.string().trim().min(3).max(255),
    role: z.enum(INVITABLE_WORKSPACE_ROLES).default("MEMBER"),
  })
  .strict();

/** GET /api/workspaces/[id]/invites — list pending email invitations. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-invites-read",
      RATE_LIMITS.jobsRead,
      "Invitations",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id } = await context.params;
    const result = await listWorkspaceInvites(id, authState.userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners and admins can view invitations",
        authState.limit,
      );
    }
    return jsonWithLimit(result.invites, authState.limit);
  });
}

/** POST /api/workspaces/[id]/invites — issue an expiring invite link. */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-invite-create",
      RATE_LIMITS.workspaceInvite,
      "Team invitations",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      CreateInviteSchema,
      authState.limit,
      "Enter a valid email address and role",
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await createWorkspaceInvite(
      id,
      authState.userId,
      parsed.data.email,
      parsed.data.role,
    );
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners and admins can create invitations",
        authState.limit,
      );
    }
    if (result.kind === "INVALID_EMAIL") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Enter a valid email address",
        authState.limit,
      );
    }
    if (result.kind === "ALREADY_MEMBER") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Someone with that email is already on this team",
        authState.limit,
      );
    }
    return jsonWithLimit(
      { invite: result.invite, url: result.url },
      authState.limit,
      201,
    );
  });
}
