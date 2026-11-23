import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isStrongSecret, workerApiToken } from "@opencontext/config";
import { ERROR_STATUS, type ErrorCode } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  type RateLimitResult as ConsumedRateLimitResult,
} from "@/server/security/rate-limit";

/** Worker id header carried by every job-scoped worker request. */
export const WORKER_ID_HEADER = "x-worker-id";

/**
 * Error envelope: `{"error": {"code", "message", "stage?"}}` (blueprint
 * §2). Status comes from the shared ERROR_STATUS map.
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  stage?: string,
): NextResponse {
  return NextResponse.json(
    { error: stage ? { code, message, stage } : { code, message } },
    { status: ERROR_STATUS[code] },
  );
}

/**
 * Bearer-token check for worker endpoints with a constant-time compare
 * (ADR-0005). An unconfigured token denies everything — a worker API with
 * no secret must never be open.
 */
export function verifyWorkerToken(request: Request): boolean {
  const expected = workerApiToken();
  if (!isStrongSecret(expected, 16)) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  return safeEqual(match[1], expected!.trim());
}

/** Bearer-token check for the read-only operations alert endpoint. */
export function verifyOpsToken(request: Request): boolean {
  const expected = process.env.OPS_API_TOKEN?.trim() ?? "";
  if (!isStrongSecret(expected, 16)) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match !== null && safeEqual(match[1], expected);
}

function safeEqual(candidate: string, expected: string): boolean {
  // Fixed-width digests avoid leaking the configured token length through
  // timingSafeEqual's required equal-buffer-length check.
  const a = createHash("sha256").update(candidate.trim(), "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Read and validate the worker id from the header (or body/query). */
export function workerIdOf(request: Request, body?: { workerId?: string }): string | null {
  const fromHeader = request.headers.get(WORKER_ID_HEADER);
  if (fromHeader) return validWorkerId(fromHeader);
  if (body?.workerId) return validWorkerId(body.workerId);
  const url = new URL(request.url);
  return validWorkerId(url.searchParams.get("workerId"));
}

/** Worker ids are also used as bounded database-rate-limit keys. */
function validWorkerId(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/.test(normalized)
    ? normalized
    : null;
}

/**
 * Verify a job exists and is currently claimed by `workerId`. Returns the
 * job row, or a typed failure for the route to translate.
 */
export type ClaimCheck =
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_CLAIMED" }
  | { kind: "OK"; job: NonNullable<Awaited<ReturnType<typeof prisma.job.findUnique>>> };

export async function checkClaim(jobId: string, workerId: string | null): Promise<ClaimCheck> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { kind: "NOT_FOUND" };
  }
  if (
    !workerId ||
    job.claimedBy !== workerId ||
    !job.leaseUntil ||
    job.leaseUntil.getTime() <= Date.now()
  ) {
    return { kind: "NOT_CLAIMED" };
  }
  return { kind: "OK", job };
}

/** Wrap unknown handler errors into the INTERNAL envelope. */
export async function withErrorHandling(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if ((error as { code?: unknown }).code === "LEASE_LOST") {
      return errorResponse(
        "WORKER_UNAUTHORIZED",
        "This worker no longer holds the job lease; stop and claim work again",
      );
    }
    console.error("Unhandled API error:", error);
    return errorResponse("INTERNAL", "Something went wrong on our side");
  }
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "TOO_LARGE" | "INVALID" };

/** Read JSON from the request stream with a real byte cap (not only Content-Length). */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyResult> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, reason: "INVALID" };
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, reason: "INVALID" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: "INVALID" };
  }
}

/** Accept JSON and structured-syntax `+json` media types only. */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    (mediaType?.startsWith("application/") === true &&
      mediaType.endsWith("+json"))
  );
}

/** Apply a route-level limit and return a ready-to-send 429 when blocked. */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const result: ConsumedRateLimitResult = await consumeRateLimit(key, limit, windowMs);
  if (result.allowed) return null;
  return applyRateLimitHeaders(
    errorResponse(
      result.unavailable ? "INTERNAL" : "RATE_LIMITED",
      result.unavailable
        ? "Service temporarily unavailable — try again shortly"
        : `Request limit reached — try again in ${result.retryAfterSec} seconds`,
    ),
    result,
  );
}

/** Translate quota denial vs. a fail-closed limiter outage distinctly. */
export function rateLimitDeniedResponse(
  result: ConsumedRateLimitResult,
  subject = "Request",
): NextResponse {
  return applyRateLimitHeaders(
    errorResponse(
      result.unavailable ? "INTERNAL" : "RATE_LIMITED",
      result.unavailable
        ? "Service temporarily unavailable — try again shortly"
        : `${subject} limit reached — try again in ${result.retryAfterSec} seconds`,
    ),
    result,
  );
}
