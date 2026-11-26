import { NextResponse } from "next/server";
import {
  errorResponse,
  readRawBody,
  withErrorHandling,
} from "@/server/api-helpers";
import { processStripeWebhook } from "@/server/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1_000_000;

/** POST /api/stripe/webhook — Stripe signature-authenticated billing sync. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0];
    if (contentType?.trim().toLowerCase() !== "application/json") {
      return errorResponse("VALIDATION_ERROR", "Expected an application/json body");
    }
    const body = await readRawBody(request, MAX_WEBHOOK_BYTES);
    if (!body.ok) {
      return body.reason === "TOO_LARGE"
        ? errorResponse("FILE_TOO_LARGE", "Webhook body is too large")
        : errorResponse("VALIDATION_ERROR", "Could not read webhook body");
    }

    const result = await processStripeWebhook(
      new TextDecoder().decode(body.bytes),
      request.headers.get("stripe-signature"),
    );
    if (result.kind === "PROCESSED" || result.kind === "DUPLICATE") {
      return NextResponse.json({ received: true, handled: result.kind === "PROCESSED" && result.handled });
    }
    if (result.kind === "INVALID_SIGNATURE") {
      return errorResponse("VALIDATION_ERROR", "Invalid Stripe webhook signature");
    }
    if (result.kind === "INVALID_MODE") {
      return errorResponse("VALIDATION_ERROR", "Stripe webhook mode does not match configuration");
    }
    if (result.kind === "UNAVAILABLE") {
      return errorResponse("BILLING_UNAVAILABLE", "Stripe billing is not configured");
    }
    return errorResponse("INTERNAL", "Could not process Stripe webhook");
  });
}
