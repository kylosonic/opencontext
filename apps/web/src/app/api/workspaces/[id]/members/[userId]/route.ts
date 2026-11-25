import { z } from "zod";
import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  noContentWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";
import {
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  WORKSPACE_ALL_ROLES,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; userId: string }> };

const UpdateRoleSchema = z
  .object({ role: z.enum(WORKSPACE_ALL_ROLES) })
  .strict();

/** PATCH /api/workspaces/[id]/members/[userId] — update a member's role. */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-member-update",
      RATE_LIMITS.workspaceMember,
      "Membership changes",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      UpdateRoleSchema,
      authState.limit,
      "Select a valid team role",
    );
    if (!parsed.ok) return parsed.response;

    const { id, userId } = await context.params;
    const result = await updateWorkspaceMemberRole(
      id,
      authState.userId,
      userId,
      parsed.data.role,
    );
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team member not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to change this member's role",
        authState.limit,
      );
    }
    if (result.kind === "LAST_OWNER") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "A team must keep at least one owner",
        authState.limit,
      );
    }
    return jsonWithLimit({ userId: result.userId, role: result.role }, authState.limit);
  });
}

/** DELETE /api/workspaces/[id]/members/[userId] — remove member or leave team. */
export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-member-remove",
      RATE_LIMITS.workspaceMember,
      "Membership changes",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id, userId } = await context.params;
    const result = await removeWorkspaceMember(id, authState.userId, userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team member not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to remove this member",
        authState.limit,
      );
    }
    if (result.kind === "LAST_OWNER") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Promote another owner before leaving or removing the sole owner",
        authState.limit,
      );
    }
    return noContentWithLimit(authState.limit);
  });
}
