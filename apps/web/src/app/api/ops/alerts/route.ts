import { NextResponse } from "next/server";
import { verifyOpsToken } from "@/server/api-helpers";
import { evaluateOperations, thresholdsFromEnv } from "@/server/operations/alerts";
import { withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ops/alerts — an authenticated aggregate for an external alert
 * receiver. It does not expose job prompts, media, credentials, or object URLs.
 */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyOpsToken(request)) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing operations token" } },
        { status: 401 },
      );
    }
    const report = await evaluateOperations(new Date(), thresholdsFromEnv());
    return NextResponse.json(report, {
      status: report.healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
