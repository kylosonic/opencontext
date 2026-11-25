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
  deleteWorkspaceCustomRole,
  updateWorkspaceCustomRole,
  WORKSPACE_PERMISSIONS,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; roleId: string }> };

const UpdateCustomRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: z.array(z.enum(WORKSPACE_PERMISSIONS)).min(1).optional(),
  })
  .strict();

/** PATCH /api/workspaces/[id]/roles/[roleId] — edit a custom role. */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-role-update",
      RATE_LIMITS.workspaceMutation,
      "Workspace roles",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      UpdateCustomRoleSchema,
      authState.limit,
      "Provide valid custom role fields",
    );
    if (!parsed.ok) return parsed.response;

    const { id, roleId } = await context.params;
    const result = await updateWorkspaceCustomRole(
      id,
      authState.userId,
      roleId,
      parsed.data,
    );
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Custom role not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to manage custom roles",
        authState.limit,
      );
    }
    if (result.kind === "DUPLICATE_NAME") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "A custom role with that name already exists in this team",
        authState.limit,
      );
    }
    if (result.kind === "INVALID") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Provide a valid role name and at least one permission",
        authState.limit,
      );
    }
    return jsonWithLimit(result.role, authState.limit);
  });
}

/** DELETE /api/workspaces/[id]/roles/[roleId] — delete a custom role. */
export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-role-delete",
      RATE_LIMITS.workspaceMutation,
      "Workspace roles",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id, roleId } = await context.params;
    const result = await deleteWorkspaceCustomRole(id, authState.userId, roleId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Custom role not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have permission to manage custom roles",
        authState.limit,
      );
    }
    return noContentWithLimit(authState.limit);
  });
}
