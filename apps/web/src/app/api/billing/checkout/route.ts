import { BillingScopeRequestSchema } from "@kylosonic/opencontext-schemas";
import { withErrorHandling } from "@/server/api-helpers";
import {
  checkoutSessionForUser,
  type CheckoutSessionResult,
} from "@/server/billing/stripe";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

function checkoutError(
  result: Exclude<CheckoutSessionResult, { kind: "OK" }>,
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
    "VALIDATION_ERROR",
    "This scope already has a subscription; open the billing portal to manage it",
    limit,
  );
}

/** POST /api/billing/checkout — create a Stripe-hosted subscription session. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "billing-checkout",
      RATE_LIMITS.billingMutation,
      "Billing checkout",
    );
    if (authState.kind !== "OK") return authState.response;

    const parsed = await parseValidatedJson(
      request,
      BillingScopeRequestSchema,
      authState.limit,
      "workspaceId must be a string or null",
    );
    if (!parsed.ok) return parsed.response;

    const result = await checkoutSessionForUser(authState.userId, {
      workspaceId: parsed.data.workspaceId ?? undefined,
    });
    if (result.kind !== "OK") return checkoutError(result, authState.limit);
    return jsonWithLimit({ url: result.url }, authState.limit);
  });
}
