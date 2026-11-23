import { handlers } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
} from "@/server/security/rate-limit";

/**
 * Auth.js v5 route handler for /api/auth/[...nextauth].
 */
async function limited(
  request: NextRequest,
  handler: (request: NextRequest) => Response | Promise<Response>,
): Promise<Response> {
  const limit = await consumeRateLimit(
    requestRateKey(request, "auth"),
    RATE_LIMITS.auth.limit,
    RATE_LIMITS.auth.windowMs,
  );
  if (!limit.allowed) {
    return applyRateLimitHeaders(
      NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: `Authentication limit reached — try again in ${limit.retryAfterSec} seconds`,
          },
        },
        { status: 429 },
      ),
      limit,
    );
  }
  return applyRateLimitHeaders(await handler(request), limit);
}

export function GET(request: NextRequest): Promise<Response> {
  return limited(request, handlers.GET);
}

export function POST(request: NextRequest): Promise<Response> {
  return limited(request, handlers.POST);
}
