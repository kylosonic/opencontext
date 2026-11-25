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
import { deleteWorkspace, renameWorkspace } from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const RenameWorkspaceSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

/** PATCH /api/workspaces/[id] — rename a team workspace (OWNER/ADMIN). */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-mutate",
      RATE_LIMITS.workspaceMutation,
      "Team updates",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      RenameWorkspaceSchema,
      authState.limit,
      "Team names must be 1–80 characters",
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await renameWorkspace(id, authState.userId, parsed.data.name);
    if (result.kind === "INVALID") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Team names must be 1–80 characters",
        authState.limit,
      );
    }
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners and admins can rename teams",
        authState.limit,
      );
    }
    return jsonWithLimit(result.workspace, authState.limit);
  });
}

/** DELETE /api/workspaces/[id] — delete a team workspace (OWNER only). */
export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-mutate",
      RATE_LIMITS.workspaceMutation,
      "Team deletion",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id } = await context.params;
    const result = await deleteWorkspace(id, authState.userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only a team owner can delete a team",
        authState.limit,
      );
    }
    return noContentWithLimit(authState.limit);
  });
}
