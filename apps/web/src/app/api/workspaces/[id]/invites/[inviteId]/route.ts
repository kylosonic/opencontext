import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  noContentWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";
import { revokeWorkspaceInvite } from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; inviteId: string }> };

/** DELETE /api/workspaces/[id]/invites/[inviteId] — revoke a pending invite. */
export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-invite-revoke",
      RATE_LIMITS.workspaceInvite,
      "Team invitations",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id, inviteId } = await context.params;
    const result = await revokeWorkspaceInvite(id, authState.userId, inviteId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Invitation not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners and admins can revoke invitations",
        authState.limit,
      );
    }
    return noContentWithLimit(authState.limit);
  });
}
