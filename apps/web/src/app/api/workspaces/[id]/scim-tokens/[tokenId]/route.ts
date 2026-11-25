import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  noContentWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";
import { revokeWorkspaceScimToken } from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; tokenId: string }> };

/** DELETE /api/workspaces/[id]/scim-tokens/[tokenId] — revoke a SCIM bearer token. */
export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-scim-token-revoke",
      RATE_LIMITS.workspaceMutation,
      "SCIM tokens",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id, tokenId } = await context.params;
    const result = await revokeWorkspaceScimToken(id, authState.userId, tokenId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "SCIM token not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners can revoke SCIM tokens",
        authState.limit,
      );
    }
    return noContentWithLimit(authState.limit);
  });
}
