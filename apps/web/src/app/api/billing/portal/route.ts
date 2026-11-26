import { BillingScopeRequestSchema } from "@kylosonic/opencontext-schemas";
import { withErrorHandling } from "@/server/api-helpers";
import {
  portalSessionForUser,
  type PortalSessionResult,
} from "@/server/billing/stripe";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

function portalError(
  result: Exclude<PortalSessionResult, { kind: "OK" }>,
  limit: Parameters<typeof errorWithLimit>[2],
): Response {
  if (result.kind === "UNAVAILABLE") {
    return errorWithLimit(
      "BILLING_UNAVAILABLE",
      "Billing is not configured for this deployment",
      limit,
    );
  }
  if (result.kind === "FORBIDDEN") {
    return errorWithLimit(
      "FORBIDDEN",
      "You don't have permission to manage billing for this scope",
      limit,
    );
  }
  return errorWithLimit(
    "NOT_FOUND",
    "No billing customer exists for this scope",
    limit,
  );
}

/** POST /api/billing/portal — open Stripe's hosted Billing Portal. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "billing-portal",
      RATE_LIMITS.billingMutation,
      "Billing portal",
    );
    if (authState.kind !== "OK") return authState.response;

    const parsed = await parseValidatedJson(
      request,
      BillingScopeRequestSchema,
      authState.limit,
      "workspaceId must be a string or null",
    );
    if (!parsed.ok) return parsed.response;

    const result = await portalSessionForUser(authState.userId, {
      workspaceId: parsed.data.workspaceId ?? undefined,
    });
    if (result.kind !== "OK") return portalError(result, authState.limit);
    return jsonWithLimit({ url: result.url }, authState.limit);
  });
}
