import { beforeEach, describe, expect, it } from "vitest";
import { verifyWorkerToken } from "@/server/api-helpers";
import {
  consumeRateLimit,
  resetRateLimits,
} from "@/server/security/rate-limit";

beforeEach(() => {
  resetRateLimits();
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
  it("allows the configured count and then returns retry timing", () => {
    expect(consumeRateLimit("user:1", 2, 60_000, 1_000).allowed).toBe(true);
    expect(consumeRateLimit("user:1", 2, 60_000, 2_000).allowed).toBe(true);
    const blocked = consumeRateLimit("user:1", 2, 60_000, 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(58);
  });

  it("resets after the fixed window", () => {
    expect(consumeRateLimit("user:2", 1, 1_000, 1_000).allowed).toBe(true);
    expect(consumeRateLimit("user:2", 1, 1_000, 1_500).allowed).toBe(false);
    expect(consumeRateLimit("user:2", 1, 1_000, 2_001).allowed).toBe(true);
  });

  it("keys limits independently", () => {
    expect(consumeRateLimit("a", 1, 1_000).allowed).toBe(true);
    expect(consumeRateLimit("b", 1, 1_000).allowed).toBe(true);
  });
});
