import { NextResponse } from "next/server";
import type { z } from "zod";
import { auth } from "@/auth";
import {
  errorResponse,
  rateLimitDeniedResponse,
  readJsonBody,
} from "@/server/api-helpers";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  type RateLimitResult,
} from "@/server/security/rate-limit";

export type GuardedSession =
  | { kind: "DENIED"; response: Response }
  | { kind: "OK"; userId: string; limit: RateLimitResult };

/** Authenticate the browser session and enforce a user-scoped rate limit. */
export async function requireSessionWithLimit(
  namespace: string,
  budget: { limit: number; windowMs: number },
  subject: string,
): Promise<GuardedSession> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      kind: "DENIED",
      response: errorResponse("UNAUTHORIZED", "Sign in required"),
    };
  }
  const limit = await consumeRateLimit(
    `${namespace}:${session.user.id}`,
    budget.limit,
    budget.windowMs,
  );
  if (!limit.allowed) {
    return {
      kind: "DENIED",
      response: rateLimitDeniedResponse(limit, subject),
    };
  }
  return { kind: "OK", userId: session.user.id, limit };
}

/** Read and validate a strict JSON body against a Zod schema. */
export async function parseValidatedJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit: RateLimitResult,
  invalidMessage: string,
  maxBytes = 8_192,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const body = await readJsonBody(request, maxBytes);
  if (!body.ok) {
    return {
      ok: false,
      response: applyRateLimitHeaders(
        errorResponse("VALIDATION_ERROR", "Request body must be valid JSON"),
        limit,
      ),
    };
  }
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    return {
      ok: false,
      response: applyRateLimitHeaders(
        errorResponse("VALIDATION_ERROR", invalidMessage),
        limit,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function jsonWithLimit(
  data: unknown,
  limit: RateLimitResult,
  status = 200,
): Response {
  return applyRateLimitHeaders(NextResponse.json(data, { status }), limit);
}

export function noContentWithLimit(limit: RateLimitResult): Response {
  return applyRateLimitHeaders(new NextResponse(null, { status: 204 }), limit);
}

export function errorWithLimit(
  code: Parameters<typeof errorResponse>[0],
  message: string,
  limit: RateLimitResult,
): Response {
  return applyRateLimitHeaders(errorResponse(code, message), limit);
}
