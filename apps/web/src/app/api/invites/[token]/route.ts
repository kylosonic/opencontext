import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";
import {
  acceptWorkspaceInvite,
  inspectWorkspaceInvite,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string }> };

/** GET /api/invites/[token] — inspect an invitation status before accepting. */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "invite-inspect",
      RATE_LIMITS.jobsRead,
      "Invitation lookup",
    );
    if (authState.kind !== "OK") return authState.response;

    const { token } = await context.params;
    const details = await inspectWorkspaceInvite(token);
    if (details.status === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Invitation not found", authState.limit);
    }
    return jsonWithLimit(details, authState.limit);
  });
}

/** POST /api/invites/[token] — accept an invitation for the signed-in email. */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "invite-accept",
      RATE_LIMITS.workspaceInvite,
      "Invitation acceptance",
    );
    if (authState.kind !== "OK") return authState.response;

    const { token } = await context.params;
    const result = await acceptWorkspaceInvite(token, authState.userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Invitation not found", authState.limit);
    }
    if (result.kind === "REVOKED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "This invitation was revoked by a team administrator",
        authState.limit,
      );
    }
    if (result.kind === "ACCEPTED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "This invitation has already been accepted",
        authState.limit,
      );
    }
    if (result.kind === "EXPIRED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "This invitation has expired — ask a team administrator for a new link",
        authState.limit,
      );
    }
    if (result.kind === "EMAIL_REQUIRED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Your signed-in account has no verified email address matching this invitation",
        authState.limit,
      );
    }
    if (result.kind === "EMAIL_MISMATCH") {
      return errorWithLimit(
        "FORBIDDEN",
        `Sign in with ${result.expectedEmail} to accept this invitation`,
        authState.limit,
      );
    }
    return jsonWithLimit(
      {
        workspaceId: result.workspaceId,
        workspaceName: result.workspaceName,
        role: result.role,
      },
      authState.limit,
    );
  });
}
