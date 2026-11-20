import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOpsToken, verifyWorkerToken } from "@/server/api-helpers";
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
});
