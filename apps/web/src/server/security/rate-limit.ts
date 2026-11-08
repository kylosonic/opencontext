import { Prisma } from "@prisma/client";
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
    if ((process.env.RATE_LIMIT_FAILURE_MODE ?? "open").toLowerCase() === "closed") {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
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
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSec: 0,
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
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
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
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
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
    };
  }

  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
  return {
    allowed: false,
    remaining: 0,
    retryAfterSec: bucket
      ? Math.max(1, Math.ceil((bucket.resetAt.getTime() - now) / 1000))
      : 1,
  };
}

/** Test helper only. */
export async function resetRateLimits(): Promise<void> {
  buckets.clear();
  if ((process.env.RATE_LIMIT_BACKEND ?? "memory").toLowerCase() === "database") {
    await prisma.rateLimitBucket.deleteMany();
  }
}
