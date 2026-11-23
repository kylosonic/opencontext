import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rateLimitDeniedResponse,
  verifyOpsToken,
  verifyWorkerToken,
  workerIdOf,
} from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import {
  consumeRateLimit,
  RATE_LIMITS,
  resetRateLimits,
} from "@/server/security/rate-limit";

beforeEach(async () => {
  vi.restoreAllMocks();
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.RATE_LIMIT_FAILURE_MODE;
  await resetRateLimits();
});

describe("worker token authentication", () => {
  it("accepts the configured bearer token", () => {
    const request = new Request("http://test.local/api/worker/jobs/claim", {
      headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}` },
    });
    expect(verifyWorkerToken(request)).toBe(true);
  });

  it("rejects unbounded or malformed worker ids used as quota keys", () => {
    const valid = new Request("http://test.local/", {
      headers: { "x-worker-id": "github-123_runner:west+1" },
    });
    expect(workerIdOf(valid)).toBe("github-123_runner:west+1");

    for (const workerId of ["", "bad worker", "a".repeat(129), "../escape"]) {
      const request = new Request("http://test.local/", {
        headers: { "x-worker-id": workerId },
      });
      expect(workerIdOf(request)).toBeNull();
    }
  });

  it("rejects missing, malformed, and incorrect tokens", () => {
    expect(verifyWorkerToken(new Request("http://test.local/"))).toBe(false);
    expect(
      verifyWorkerToken(
        new Request("http://test.local/", {
          headers: { Authorization: "Basic abc" },
        }),
      ),
    ).toBe(false);
    expect(
      verifyWorkerToken(
        new Request("http://test.local/", {
          headers: { Authorization: "Bearer wrong-token" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects placeholder tokens and accepts a trimmed header value", () => {
    const previous = process.env.WORKER_API_TOKEN;
    try {
      process.env.WORKER_API_TOKEN = "change-me";
      expect(
        verifyWorkerToken(
          new Request("http://test.local/", {
            headers: { Authorization: "Bearer change-me" },
          }),
        ),
      ).toBe(false);

      process.env.WORKER_API_TOKEN = "  worker-token-at-least-16  ";
      expect(
        verifyWorkerToken(
          new Request("http://test.local/", {
            headers: { Authorization: "Bearer worker-token-at-least-16" },
          }),
        ),
      ).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WORKER_API_TOKEN;
      else process.env.WORKER_API_TOKEN = previous;
    }
  });
});

describe("operations token authentication", () => {
  it("fails closed until a separate operations token is configured", () => {
    const previous = process.env.OPS_API_TOKEN;
    delete process.env.OPS_API_TOKEN;
    try {
      const request = new Request("http://test.local/api/ops/alerts", {
        headers: { Authorization: "Bearer anything" },
      });
      expect(verifyOpsToken(request)).toBe(false);
      process.env.OPS_API_TOKEN = "operations-test-token-at-least-16";
      expect(verifyOpsToken(request)).toBe(false);
      expect(
        verifyOpsToken(
          new Request("http://test.local/api/ops/alerts", {
            headers: { Authorization: "Bearer operations-test-token-at-least-16" },
          }),
        ),
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.OPS_API_TOKEN;
      } else {
        process.env.OPS_API_TOKEN = previous;
      }
    }
  });
});

describe("fixed-window rate limiting", () => {
  it("allows the configured count and then returns retry timing", async () => {
    expect((await consumeRateLimit("user:1", 2, 60_000, 1_000)).allowed).toBe(true);
    expect((await consumeRateLimit("user:1", 2, 60_000, 2_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit("user:1", 2, 60_000, 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(58);
    expect(blocked.limit).toBe(2);
    expect(blocked.backend).toBe("memory");
  });

  it("resets after the fixed window", async () => {
    expect((await consumeRateLimit("user:2", 1, 1_000, 1_000)).allowed).toBe(true);
    expect((await consumeRateLimit("user:2", 1, 1_000, 1_500)).allowed).toBe(false);
    expect((await consumeRateLimit("user:2", 1, 1_000, 2_001)).allowed).toBe(true);
  });

  it("keys limits independently", async () => {
    expect((await consumeRateLimit("a", 1, 1_000)).allowed).toBe(true);
    expect((await consumeRateLimit("b", 1, 1_000)).allowed).toBe(true);
  });

  it("shares quotas through the database backend", async () => {
    process.env.RATE_LIMIT_BACKEND = "database";
    await resetRateLimits();

    expect((await consumeRateLimit("shared", 2, 60_000, 1_000)).allowed).toBe(true);
    expect((await consumeRateLimit("shared", 2, 60_000, 2_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit("shared", 2, 60_000, 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(58);
    expect(blocked.backend).toBe("database");
    expect(await prisma.rateLimitBucket.count()).toBe(1);
  });

  it("recreates a bucket removed by cleanup instead of returning a false 429", async () => {
    process.env.RATE_LIMIT_BACKEND = "database";
    await resetRateLimits();
    await prisma.rateLimitBucket.create({
      data: { key: "cleanup-race", count: 1, resetAt: new Date(1) },
    });
    const update = vi.spyOn(prisma.rateLimitBucket, "updateMany").mockImplementationOnce(
      (async () => {
        await prisma.rateLimitBucket.delete({ where: { key: "cleanup-race" } });
        return { count: 0 };
      }) as never,
    );
    update.mockReturnValue(Promise.resolve({ count: 0 }) as never);

    const result = await consumeRateLimit("cleanup-race", 1, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.backend).toBe("database");
    expect((await prisma.rateLimitBucket.findUnique({ where: { key: "cleanup-race" } }))?.count).toBe(1);
  });

  it("honors fail-closed and fail-open backend failure modes", async () => {
    process.env.RATE_LIMIT_BACKEND = "database";
    await resetRateLimits();
    vi.spyOn(prisma.rateLimitBucket, "create").mockRejectedValue(
      new Error("database unavailable"),
    );

    process.env.RATE_LIMIT_FAILURE_MODE = "closed";
    const closed = await consumeRateLimit("failure", 1, 60_000);
    expect(closed.allowed).toBe(false);
    expect(closed.retryAfterSec).toBe(30);
    expect(closed.backend).toBe("unavailable");
    expect(closed.unavailable).toBe(true);

    process.env.RATE_LIMIT_FAILURE_MODE = "open";
    const open = await consumeRateLimit("failure", 1, 60_000);
    expect(open.allowed).toBe(true);
    expect(open.backend).toBe("memory-fallback");
    expect(open.unavailable).toBe(true);
  });

  it("keeps upload budgets usable for repeated maximum-size image sets", () => {
    expect(RATE_LIMITS.uploadIntent.limit).toBeGreaterThanOrEqual(120);
    expect(RATE_LIMITS.uploadIntent.windowMs).toBe(10 * 60_000);
  });

  it("reports a fail-closed limiter outage as internal rather than quota", async () => {
    const response = rateLimitDeniedResponse({
      allowed: false,
      remaining: 0,
      retryAfterSec: 30,
      limit: 10,
      resetAt: Date.now() + 30_000,
      backend: "unavailable",
      unavailable: true,
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL");
  });
});
