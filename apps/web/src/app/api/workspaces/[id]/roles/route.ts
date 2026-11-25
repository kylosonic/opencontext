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
  createWorkspaceCustomRole,
  listWorkspaceCustomRoles,
  WORKSPACE_PERMISSIONS,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const CreateCustomRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: z.array(z.enum(WORKSPACE_PERMISSIONS)).min(1),
  })
  .strict();

/** GET /api/workspaces/[id]/roles — list custom roles defined in a workspace. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-roles-read",
      RATE_LIMITS.jobsRead,
      "Workspace roles",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id } = await context.params;
    const result = await listWorkspaceCustomRoles(id, authState.userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("FORBIDDEN", "You don't have access to this team", authState.limit);
    }
    return jsonWithLimit(result.roles, authState.limit);
  });
}

/** POST /api/workspaces/[id]/roles — create a workspace custom role. */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-role-create",
      RATE_LIMITS.workspaceMutation,
      "Workspace roles",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      CreateCustomRoleSchema,
      authState.limit,
      "Provide a role name and at least one permission",
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await createWorkspaceCustomRole(id, authState.userId, parsed.data);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
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
    if (result.kind === "LIMIT_REACHED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Maximum number of custom roles reached for this team",
        authState.limit,
      );
    }
    if (result.kind === "INVALID") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Provide a role name and valid permissions",
        authState.limit,
      );
    }
    return jsonWithLimit(result.role, authState.limit, 201);
  });
}
