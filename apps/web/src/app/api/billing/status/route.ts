import { withErrorHandling } from "@/server/api-helpers";
import { billingOverviewForUser } from "@/server/billing/stripe";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

/** GET /api/billing/status — configured mode and subscription state. */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "billing-status",
      RATE_LIMITS.usageRead,
      "Billing status",
    );
    if (authState.kind !== "OK") return authState.response;

    const workspaceId =
      new URL(request.url).searchParams.get("workspaceId")?.trim() || undefined;
    if (workspaceId && workspaceId.length > 128) {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "workspaceId is too long",
        authState.limit,
      );
    }
    const overview = await billingOverviewForUser(authState.userId, {
      workspaceId,
    });
    if (!overview) {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have access to that team's billing",
        authState.limit,
      );
    }
    return jsonWithLimit(overview, authState.limit);
  });
}
