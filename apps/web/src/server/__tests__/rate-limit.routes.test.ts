import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  handlers: {
    GET: vi.fn(() => new Response("unexpected auth handler call")),
    POST: vi.fn(() => new Response("unexpected auth handler call")),
  },
}));

import { GET as getAuth } from "@/app/api/auth/[...nextauth]/route";
import { POST as sweepRetention } from "@/app/api/admin/retention-sweep/route";
import { GET as getOperations } from "@/app/api/ops/alerts/route";
import { POST as postWorkerHeartbeat } from "@/app/api/worker/heartbeat/route";
import {
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
  resetRateLimits,
} from "@/server/security/rate-limit";

const testIp = "203.0.113.42";

function request(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-vercel-forwarded-for", testIp);
  return new NextRequest(`http://test.local${path}`, { ...init, headers });
}

async function exhaust(request: Request, namespace: string, limit: number): Promise<void> {
  const key = requestRateKey(request, namespace);
  for (let index = 0; index < limit; index += 1) {
    const result = await consumeRateLimit(key, limit, 60_000);
    expect(result.allowed).toBe(true);
  }
}

function expectGenuineQuota429(response: Response, limit: number): void {
  expect(response.status).toBe(429);
  expect(response.headers.get("X-RateLimit-Limit")).toBe(String(limit));
  expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
}

beforeEach(async () => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("OPS_API_TOKEN", "operations-route-token-at-least-16");
  await resetRateLimits();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("route-level quota enforcement", () => {
  it("limits authentication requests by resolved client address", async () => {
    const req = request("/api/auth/session", { method: "GET" });
    await exhaust(req, "auth", RATE_LIMITS.auth.limit);

    const response = await getAuth(req);

    expectGenuineQuota429(response, RATE_LIMITS.auth.limit);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
  });

  it("limits idle worker heartbeats after authentication", async () => {
    const req = request("/api/worker/heartbeat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workerId: "route-limit-worker" }),
    });
    await exhaust(req, "worker-heartbeat", RATE_LIMITS.workerHeartbeat.limit);

    const response = await postWorkerHeartbeat(req);

    expectGenuineQuota429(response, RATE_LIMITS.workerHeartbeat.limit);
  });

  it("limits operations reads after token authentication", async () => {
    const req = request("/api/ops/alerts", {
      method: "GET",
      headers: { Authorization: "Bearer operations-route-token-at-least-16" },
    });
    await exhaust(req, "operations-alerts", RATE_LIMITS.operations.limit);

    const response = await getOperations(req);

    expectGenuineQuota429(response, RATE_LIMITS.operations.limit);
  });

  it("limits expensive retention sweeps", async () => {
    const req = request("/api/admin/retention-sweep", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}` },
    });
    await exhaust(req, "retention-sweep", RATE_LIMITS.retentionSweep.limit);

    const response = await sweepRetention(req);

    expectGenuineQuota429(response, RATE_LIMITS.retentionSweep.limit);
  });
});
