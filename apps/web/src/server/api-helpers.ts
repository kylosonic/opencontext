import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { workerApiToken } from "@opencontext/config";
import { ERROR_STATUS, type ErrorCode } from "@opencontext/schemas";
import { prisma } from "@/server/db/prisma";

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
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) {
    return false;
  }
  return safeEqual(match[1], expected);
}

function safeEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Read the worker id from the header (or body/query for convenience). */
export function workerIdOf(request: Request, body?: { workerId?: string }): string | null {
  const fromHeader = request.headers.get(WORKER_ID_HEADER);
  if (fromHeader) {
    return fromHeader;
  }
  if (body?.workerId) {
    return body.workerId;
  }
  const url = new URL(request.url);
  return url.searchParams.get("workerId");
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
  if (!workerId || job.claimedBy !== workerId) {
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
    console.error("Unhandled API error:", error);
    return errorResponse("INTERNAL", "Something went wrong on our side");
  }
}
