import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWorkerToken } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import {
  consumeRateLimit,
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

describe("fixed-window rate limiting", () => {
  it("allows the configured count and then returns retry timing", async () => {
    expect((await consumeRateLimit("user:1", 2, 60_000, 1_000)).allowed).toBe(true);
    expect((await consumeRateLimit("user:1", 2, 60_000, 2_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit("user:1", 2, 60_000, 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(58);
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
    expect(closed.retryAfterSec).toBe(60);

    process.env.RATE_LIMIT_FAILURE_MODE = "open";
    const open = await consumeRateLimit("failure", 1, 60_000);
    expect(open.allowed).toBe(true);
  });
});
