import { withErrorHandling } from "@/server/api-helpers";
import {
  usageInvoiceForUser,
  usageInvoiceToCsv,
} from "@/server/billing/invoice";
import {
  applyRateLimitHeaders,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import {
  errorWithLimit,
  requireSessionWithLimit,
} from "@/server/session-guard";

export const runtime = "nodejs";

/** GET /api/usage/invoice — download a provider-neutral monthly draft invoice. */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "usage-invoice",
      RATE_LIMITS.export,
      "Usage invoice export",
    );
    if (authState.kind !== "OK") return authState.response;

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || undefined;
    if (workspaceId && workspaceId.length > 128) {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "workspaceId is too long",
        authState.limit,
      );
    }
    const format = (url.searchParams.get("format") ?? "json").trim().toLowerCase();
    if (format !== "json" && format !== "csv") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "format must be json or csv",
        authState.limit,
      );
    }

    const result = await usageInvoiceForUser(authState.userId, {
      month: url.searchParams.get("month"),
      workspaceId,
    });
    if (result.kind === "INVALID_MONTH") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "month must be between 2000-01 and 2100-12 in YYYY-MM format",
        authState.limit,
      );
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "You don't have access to that team's usage invoice",
        authState.limit,
      );
    }
    if (result.kind === "TOO_LARGE") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "This month has more than 10,000 usage records; narrow the scope or use the operations export",
        authState.limit,
      );
    }

    const { invoice } = result;
    const filename = `${invoice.invoiceNumber.toLowerCase()}.${format}`;
    const body =
      format === "csv"
        ? usageInvoiceToCsv(invoice)
        : JSON.stringify(invoice, null, 2);
    return applyRateLimitHeaders(
      new Response(body, {
        headers: {
          "Content-Type":
            format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
      authState.limit,
    );
  });
}
