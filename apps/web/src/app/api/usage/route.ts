import { withErrorHandling } from "@/server/api-helpers";
import { usageSummaryForUser } from "@/server/billing/usage";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

/** GET /api/usage — personal or team usage & cost summary for signed-in users. */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "usage-read",
      RATE_LIMITS.usageRead,
      "Usage history",
    );
    if (authState.kind !== "OK") return authState.response;

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || undefined;
    const rawDays = url.searchParams.get("days");
    let days: number | undefined;
    if (rawDays !== null && rawDays !== "") {
      const parsed = Number.parseInt(rawDays, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365) {
        return errorWithLimit(
          "VALIDATION_ERROR",
          "days must be an integer between 1 and 365",
          authState.limit,
        );
      }
      days = parsed;
    }

    const summary = await usageSummaryForUser(authState.userId, {
      workspaceId,
      days,
    });
    if (!summary) {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have access to that team's usage",
        authState.limit,
      );
    }
    return jsonWithLimit(summary, authState.limit);
  });
}
