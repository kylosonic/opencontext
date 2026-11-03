import { NextResponse } from "next/server";
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
export function GET() {
  return NextResponse.json(DEMO_RESULT, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
