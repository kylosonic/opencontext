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
 * Lightweight per-process fixed-window limiter. This prevents accidental
 * request floods in a single instance but is not a distributed quota.
 * Production deployments should also use their platform/WAF rate limits.
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
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

/** Test helper only. */
export function resetRateLimits(): void {
  buckets.clear();
}
