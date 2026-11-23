import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAlerts } from "@/app/api/ops/alerts/route";
import { POST as postHeartbeat } from "@/app/api/worker/heartbeat/route";
import {
  evaluateOperations,
  type AlertDatabase,
  type AlertThresholds,
  type JobSignal,
} from "@/server/operations/alerts";
import { LEASE_MS } from "@/server/queue";
import { createQueuedJob, createUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

const now = new Date("2026-11-18T12:00:00.000Z");
const thresholds: AlertThresholds = {
  queueAgeMinutes: 15,
  claimAgeMinutes: 10,
  jobRuntimeMinutes: 30,
  failureLookbackMinutes: 60,
};

function database(
  jobs: JobSignal[],
  leases: Array<{ key: string; resetAt: Date }> = [],
): AlertDatabase {
  return {
    job: { findMany: async () => jobs },
    rateLimitBucket: { findMany: async () => leases },
  };
}

function signal(overrides: Partial<JobSignal>): JobSignal {
  return {
    id: "job-a",
    status: "QUEUED",
    claimedBy: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

describe("operations alert snapshot", () => {
  it("reports an empty queue as healthy without inventing worker evidence", async () => {
    const report = await evaluateOperations(now, thresholds, database([]));
    expect(report.healthy).toBe(true);
    expect(report.alerts).toEqual([]);
    expect(report.lastWorkerClaimAt).toBeNull();
  });

  it("raises a critical worker-stale alert when work waits without a lease", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([signal({ createdAt: new Date(now.getTime() - 2 * 60 * 60_000) })]),
    );
    expect(report.healthy).toBe(false);
    expect(report.alerts.map((alert) => alert.code)).toEqual([
      "WORKER_STALE",
      "QUEUE_OLDEST",
    ]);
  });

  it("uses active lease renewal rather than idle claims as worker health", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([
        signal({
          status: "TRANSCRIBING",
          claimedBy: "worker-a",
          leaseUntil: new Date(now.getTime() + LEASE_MS),
        }),
      ]),
    );
    expect(report.healthy).toBe(true);
    expect(Date.parse(report.lastWorkerClaimAt ?? "")).toBe(now.getTime());
    expect(report.counts.running).toBe(1);
  });

  it("sees an idle worker heartbeat so waiting work is not falsely stale", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database(
        [signal({ createdAt: new Date(now.getTime() - 60 * 60_000) })],
        [{ key: "worker-lease:worker-a", resetAt: new Date(now.getTime() + 60_000) }],
      ),
    );
    expect(report.workers.active).toBe(1);
    expect(report.alerts.map((alert) => alert.code)).toEqual(["QUEUE_OLDEST"]);
    expect(report.healthy).toBe(true);
  });

  it("records a heartbeat without creating a user or job", async () => {
    const token = process.env.WORKER_API_TOKEN;
    process.env.WORKER_API_TOKEN = "worker-test-token-at-least-16";
    try {
      const response = await postHeartbeat(
        new NextRequest("http://test.local/api/worker/heartbeat", {
          method: "POST",
          headers: {
            Authorization: "Bearer worker-test-token-at-least-16",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workerId: "worker-heartbeat-test" }),
        }),
      );
      expect(response.status).toBe(204);
      const report = await evaluateOperations(now, thresholds);
      expect(report.workers.active).toBe(1);
      const { prisma } = await import("@/server/db/prisma");
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.job.count()).toBe(0);
    } finally {
      if (token === undefined) {
        delete process.env.WORKER_API_TOKEN;
      } else {
        process.env.WORKER_API_TOKEN = token;
      }
    }
  });

  it("serves a token-protected alert report", async () => {
    const token = process.env.OPS_API_TOKEN;
    process.env.OPS_API_TOKEN = "operations-test-token-at-least-16";
    try {
      const unauthorized = await getAlerts(
        new NextRequest("http://test.local/api/ops/alerts"),
      );
      expect(unauthorized.status).toBe(401);

      const healthy = await getAlerts(
        new NextRequest("http://test.local/api/ops/alerts", {
          headers: { Authorization: "Bearer operations-test-token-at-least-16" },
        }),
      );
      expect(healthy.status).toBe(200);
      expect(healthy.headers.get("cache-control")).toBe("no-store");

      const user = await createUser();
      await createQueuedJob(user.id);
      const stale = await getAlerts(
        new NextRequest("http://test.local/api/ops/alerts", {
          headers: { Authorization: "Bearer operations-test-token-at-least-16" },
        }),
      );
      expect(stale.status).toBe(503);
      const body = (await stale.json()) as { alerts: Array<{ code: string }> };
      expect(body.alerts.map((alert) => alert.code)).toContain("WORKER_STALE");
    } finally {
      if (token === undefined) {
        delete process.env.OPS_API_TOKEN;
      } else {
        process.env.OPS_API_TOKEN = token;
      }
    }
  });

  it("alerts on terminal failures inside the configured lookback window", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([
        signal({
          status: "PARTIAL",
          completedAt: null,
          updatedAt: new Date(now.getTime() - 5 * 60_000),
        }),
      ]),
    );
    expect(report.counts.terminalFailures).toBe(1);
    expect(report.alerts[0]?.code).toBe("JOB_FAILED");
  });

  it("alerts on a running job beyond its runtime threshold", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([
        signal({
          status: "ANALYZING",
          claimedBy: "worker-a",
          leaseUntil: new Date(now.getTime() + 5 * 60_000),
          createdAt: new Date(now.getTime() - 31 * 60_000),
          stageStates: [
            {
              stage: "ANALYZING",
              status: "RUNNING",
              startedAt: new Date(now.getTime() - 31 * 60_000).toISOString(),
            },
          ],
        }),
      ]),
    );
    expect(report.alerts.map((alert) => alert.code)).toEqual(["JOB_STUCK"]);
  });

  it("keeps multi-day queued work visible instead of aging out of the window", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([signal({ createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60_000) })]),
    );
    expect(report.counts.queued).toBe(1);
    expect(report.oldestQueueAgeMinutes).toBe(4320);
    expect(report.alerts.map((alert) => alert.code)).toEqual([
      "WORKER_STALE",
      "QUEUE_OLDEST",
    ]);
  });

  it("treats expired mid-pipeline leases as backlog rather than healthy work", async () => {
    const report = await evaluateOperations(
      now,
      thresholds,
      database([
        signal({
          status: "ANALYZING",
          claimedBy: "worker-a",
          leaseUntil: new Date(now.getTime() - 60_000),
          createdAt: new Date(now.getTime() - 2 * 60 * 60_000),
        }),
      ]),
    );
    expect(report.counts.queued).toBe(0);
    expect(report.counts.running).toBe(0);
    expect(report.alerts.map((alert) => alert.code)).toEqual([
      "WORKER_STALE",
      "QUEUE_OLDEST",
    ]);
    expect(report.healthy).toBe(false);
  });
});
