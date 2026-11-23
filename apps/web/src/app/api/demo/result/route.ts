import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/api-helpers";
import { RATE_LIMITS, requestRateKey } from "@/server/security/rate-limit";
import { DEMO_RESULT } from "@/server/demo";

/**
 * GET /api/demo/result — public, deterministic.
 *
 * Returns the complete pre-authored demo result verbatim (metadata,
 * transcript, observations, OCR, timeline, and the developer-context
 * Markdown whose header carries the "Demo Analysis" marker).
 *
 * Zero dependencies: no database, queue, storage, environment variables, or
 * AI credentials. Cacheable; the payload never changes.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(
    requestRateKey(request, "demo-result"),
    RATE_LIMITS.demo.limit,
    RATE_LIMITS.demo.windowMs,
  );
  if (limited) return limited;
  return NextResponse.json(DEMO_RESULT, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
