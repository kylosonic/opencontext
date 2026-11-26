import { NextResponse } from "next/server";
import {
  verifyOpsToken,
  errorResponse,
  withErrorHandling,
} from "@/server/api-helpers";
import { reconcileStripeUsage } from "@/server/billing/stripe-usage";
import { reconcileAnalysisUsage } from "@/server/billing/usage";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const limit = await consumeRateLimit(
      requestRateKey(request, "ops-usage-reconcile"),
      RATE_LIMITS.operations.limit,
      RATE_LIMITS.operations.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Usage reconciliation is temporarily unavailable"
            : "Usage reconciliation limit reached — try again shortly",
        ),
        limit,
      );
    }
    if (!verifyOpsToken(request)) {
      return applyRateLimitHeaders(
        errorResponse("WORKER_UNAUTHORIZED", "Invalid operations token"),
        limit,
      );
    }
    const written = await reconcileAnalysisUsage();
    const stripe = await reconcileStripeUsage();
    return applyRateLimitHeaders(NextResponse.json({ written, stripe }), limit);
  });
}
