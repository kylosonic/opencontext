import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

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
  uploadIntent: { limit: 120, windowMs: 10 * 60_000 },
  uploadComplete: { limit: 60, windowMs: 60_000 },
  uploadCancel: { limit: 120, windowMs: 60_000 },
  jobRetry: { limit: 10, windowMs: 60_000 },
  evidenceReview: { limit: 60, windowMs: 60_000 },
} as const;

/** Add standard quota metadata and Retry-After when the request is blocked. */
export function applyRateLimitHeaders<T extends NextResponse>(
  response: T,
  result: RateLimitResult,
): T {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.max(0, Math.ceil(result.resetAt / 1000))),
  );
  response.headers.set("X-RateLimit-Backend", result.backend);
  if (!result.allowed) {
    response.headers.set("Retry-After", String(Math.max(1, result.retryAfterSec)));
  }
  return response;
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
  const backend = (process.env.RATE_LIMIT_BACKEND ?? "memory").toLowerCase();
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
    const failureMode = (process.env.RATE_LIMIT_FAILURE_MODE ?? "open").toLowerCase();
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
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
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

async function consumeDatabaseRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<RateLimitResult> {
  const nowDate = new Date(now);
  const resetAt = new Date(now + windowMs);
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
  const bucketResetAt = bucket?.resetAt.getTime() ?? resetAt.getTime();
  return {
    allowed: false,
    remaining: 0,
    retryAfterSec: bucket
      ? Math.max(1, Math.ceil((bucket.resetAt.getTime() - now) / 1000))
      : 1,
    limit,
    resetAt: bucketResetAt,
    backend: "database",
  };
}

/** Test helper only. */
export async function resetRateLimits(): Promise<void> {
  buckets.clear();
  if ((process.env.RATE_LIMIT_BACKEND ?? "memory").toLowerCase() === "database") {
    await prisma.rateLimitBucket.deleteMany();
  }
}
