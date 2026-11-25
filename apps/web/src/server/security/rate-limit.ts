import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db/prisma";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_MEMORY_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
  resetAt: number;
  backend: "memory" | "database" | "memory-fallback" | "unavailable";
  unavailable?: boolean;
}

/** Per-user budgets. Keep these centralized so route tests and docs agree. */
export const RATE_LIMITS = {
  jobsRead: { limit: 600, windowMs: 60_000 },
  jobRead: { limit: 600, windowMs: 60_000 },
  jobDelete: { limit: 60, windowMs: 60_000 },
  uploadIntent: { limit: 240, windowMs: 10 * 60_000 },
  uploadComplete: { limit: 120, windowMs: 60_000 },
  uploadCancel: { limit: 240, windowMs: 60_000 },
  uploadBody: { limit: 240, windowMs: 60_000 },
  sourceRead: { limit: 120, windowMs: 60_000 },
  export: { limit: 30, windowMs: 60_000 },
  jobRetry: { limit: 30, windowMs: 60_000 },
  evidenceReview: { limit: 120, windowMs: 60_000 },
  auth: { limit: 600, windowMs: 60_000 },
  workerClaim: { limit: 600, windowMs: 60_000 },
  workerHeartbeat: { limit: 600, windowMs: 60_000 },
  workerSource: { limit: 240, windowMs: 60_000 },
  workerMutation: { limit: 1_200, windowMs: 60_000 },
  workerMedia: { limit: 1_200, windowMs: 60_000 },
  workspaceMember: { limit: 30, windowMs: 60 * 60_000 },
  workspaceMutation: { limit: 60, windowMs: 60 * 60_000 },
  workspaceInvite: { limit: 60, windowMs: 60 * 60_000 },
  jobUpdate: { limit: 60, windowMs: 60_000 },
  jobRerun: { limit: 30, windowMs: 60_000 },
  usageRead: { limit: 120, windowMs: 60_000 },
  urlImport: { limit: 20, windowMs: 60 * 60_000 },
  workspaceCreate: { limit: 10, windowMs: 60 * 60_000 },
  publicShareSource: { limit: 240, windowMs: 60_000 },
  operations: { limit: 120, windowMs: 60_000 },
  retentionSweep: { limit: 6, windowMs: 60_000 },
  demo: { limit: 600, windowMs: 60_000 },
} as const;

function trustedProxyHops(): number {
  const parsed = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "1", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 16) : 1;
}

/** Stable, non-reversible request key using only headers from trusted hops. */
export function requestRateKey(
  request: Request,
  namespace: string,
  options?: { trustBearer?: boolean },
): string {
  const onVercel = process.env.VERCEL === "1";
  const trustProxy =
    onVercel ||
    /^(?:1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "");
  let address: string | null = null;
  if (onVercel) {
    // Vercel overwrites these platform headers. Do not fall through to the
    // client-supplied generic X-Forwarded-For/X-Vercel-Forwarded-For path.
    address =
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      null;
  } else if (trustProxy) {
    address = request.headers.get("x-real-ip")?.trim() || null;
    if (!address) {
      const chain = (request.headers.get("x-forwarded-for") ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (chain.length > 0) {
        // Proxies append to X-Forwarded-For, so the leftmost value is
        // client-controlled unless the proxy overwrites the header. Select
        // the hop immediately beyond the configured number of trusted hops.
        const index = Math.max(0, chain.length - trustedProxyHops());
        address = chain[index] ?? null;
      }
    }
  }

  // Only routes that have already verified a machine credential may opt into
  // bearer-based bucketing; unauthenticated routes must never let callers
  // mint arbitrary buckets with random Authorization headers.
  const bearer = options?.trustBearer
    ? request.headers
        .get("authorization")
        ?.match(/^Bearer\s+(.+)$/i)?.[1]
        ?.trim()
    : undefined;
  const identity = address ?? (bearer ? `bearer:${bearer}` : "untrusted-client");
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return `${namespace}:${digest}`;
}

/** Add standard quota metadata and Retry-After when the request is blocked. */
export function applyRateLimitHeaders<T extends Response>(
  response: T,
  result: RateLimitResult,
): T {
  // Fetch's redirect responses expose immutable headers. Rebuild the
  // response with a mutable header collection instead of mutating in place;
  // Auth.js commonly returns Response.redirect() for callback errors.
  const headers = new Headers(response.headers);
  const setCookieReader = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (setCookieReader) {
    const cookies = setCookieReader.call(response.headers);
    headers.delete("set-cookie");
    for (const cookie of cookies) headers.append("set-cookie", cookie);
  }
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  headers.set(
    "X-RateLimit-Reset",
    String(Math.max(0, Math.ceil(result.resetAt / 1000))),
  );
  if (!result.allowed) {
    headers.set("Retry-After", String(Math.max(1, result.retryAfterSec)));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }) as T;
}

/**
 * Consume one fixed-window slot. The default memory backend is credential-free
 * and intended for local development and single-instance deployments. Set
 * RATE_LIMIT_BACKEND=database for a storage-backed quota shared by instances.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const backend = (process.env.RATE_LIMIT_BACKEND ?? "memory").trim().toLowerCase();
  try {
    if (backend === "database") {
      return await consumeDatabaseRateLimit(key, limit, windowMs, now);
    }
    if (backend !== "memory") {
      throw new Error(`Unknown RATE_LIMIT_BACKEND: ${backend}`);
    }
    return consumeMemoryRateLimit(key, limit, windowMs, now);
  } catch (error) {
    console.error("Rate limiter backend failure:", error);
    const failureMode = (process.env.RATE_LIMIT_FAILURE_MODE ?? "open")
      .trim()
      .toLowerCase();
    if (failureMode === "closed") {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(Math.min(windowMs, 30_000) / 1000)),
        limit,
        resetAt: now + Math.min(windowMs, 30_000),
        backend: "unavailable",
        unavailable: true,
      };
    }
    // Keep a bounded local quota during a shared-backend outage instead of
    // turning a service failure into a misleading client 429.
    return {
      ...consumeMemoryRateLimit(key, limit, windowMs, now),
      backend: "memory-fallback",
      unavailable: true,
    };
  }
}

function consumeMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  pruneMemoryBuckets(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && buckets.size >= MAX_MEMORY_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: 0,
      limit,
      resetAt,
      backend: "memory",
    };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      limit,
      resetAt: current.resetAt,
      backend: "memory",
    };
  }
  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSec: 0,
    limit,
    resetAt: current.resetAt,
    backend: "memory",
  };
}

function pruneMemoryBuckets(now: number): void {
  if (buckets.size < MAX_MEMORY_BUCKETS / 2) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

async function consumeDatabaseRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<RateLimitResult> {
  const nowDate = new Date(now);
  const resetAt = new Date(now + windowMs);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.rateLimitBucket.create({
        data: { key, count: 1, resetAt, updatedAt: nowDate },
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSec: 0,
        limit,
        resetAt: resetAt.getTime(),
        backend: "database",
      };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
    }

    const reset = await prisma.rateLimitBucket.updateMany({
      where: { key, resetAt: { lte: nowDate } },
      data: { count: 1, resetAt, updatedAt: nowDate },
    });
    if (reset.count > 0) {
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSec: 0,
        limit,
        resetAt: resetAt.getTime(),
        backend: "database",
      };
    }

    const incremented = await prisma.rateLimitBucket.updateMany({
      where: { key, resetAt: { gt: nowDate }, count: { lt: limit } },
      data: { count: { increment: 1 }, updatedAt: nowDate },
    });
    if (incremented.count > 0) {
      const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
      return {
        allowed: true,
        remaining: Math.max(0, limit - (bucket?.count ?? limit)),
        retryAfterSec: 0,
        limit,
        resetAt: bucket?.resetAt.getTime() ?? resetAt.getTime(),
        backend: "database",
      };
    }

    const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
    if (bucket) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(
          1,
          Math.ceil((bucket.resetAt.getTime() - now) / 1000),
        ),
        limit,
        resetAt: bucket.resetAt.getTime(),
        backend: "database",
      };
    }
    // A retention sweep removed the expired row between our conditional
    // updates. Retry creation instead of allowing an uncounted request.
  }
  // Extreme cleanup contention is an unavailable quota backend, not proof
  // that the caller has exhausted a genuine window.
  throw new Error("Rate-limit bucket changed repeatedly during update");
}

/** Test helper only. */
export async function resetRateLimits(): Promise<void> {
  buckets.clear();
  if (
    (process.env.RATE_LIMIT_BACKEND ?? "memory").trim().toLowerCase() === "database"
  ) {
    await prisma.rateLimitBucket.deleteMany();
  }
}
