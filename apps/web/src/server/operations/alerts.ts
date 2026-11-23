import { prisma } from "@/server/db/prisma";
import { LEASE_MS } from "@/server/queue";

export const TERMINAL_STATUSES = ["COMPLETED", "PARTIAL", "FAILED"] as const;
export const RUNNING_STATUSES = [
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface AlertThresholds {
  queueAgeMinutes: number;
  claimAgeMinutes: number;
  jobRuntimeMinutes: number;
  failureLookbackMinutes: number;
}

export interface OperationsSnapshot {
  generatedAt: string;
  window: {
    from: string;
    to: string;
  };
  thresholds: AlertThresholds;
  healthy: boolean;
  workers: {
    active: number;
    renewedRecently: number;
  };
  counts: {
    queued: number;
    running: number;
    terminalFailures: number;
  };
  oldestQueueAgeMinutes: number | null;
  lastWorkerClaimAt: string | null;
  alerts: Array<{
    code: "WORKER_STALE" | "QUEUE_OLDEST" | "JOB_STUCK" | "JOB_FAILED";
    severity: "warning" | "critical";
    message: string;
  }>;
}

export type JobSignal = {
  id: string;
  status: string;
  claimedBy: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  stageStates?: unknown;
};

export type AlertDatabase = {
  job: {
    findMany(args: unknown): Promise<JobSignal[]>;
  };
  rateLimitBucket: {
    findMany(args: unknown): Promise<Array<{ key: string; resetAt: Date }>>;
  };
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function thresholdsFromEnv(): AlertThresholds {
  return {
    queueAgeMinutes: envNumber("OPS_QUEUE_AGE_MINUTES", 15),
    claimAgeMinutes: envNumber("OPS_WORKER_CLAIM_MINUTES", 10),
    jobRuntimeMinutes: envNumber("OPS_JOB_RUNTIME_MINUTES", 30),
    failureLookbackMinutes: envNumber("OPS_FAILURE_LOOKBACK_MINUTES", 60),
  };
}

function roundedMinutes(ms: number): number {
  return Math.max(0, Math.round(ms / MINUTE_MS));
}

function isActiveLease(job: JobSignal, now: Date): boolean {
  return Boolean(job.claimedBy && job.leaseUntil && job.leaseUntil > now);
}

/**
 * Build a secret-safe operational snapshot. This only reads aggregate job
 * state; it never probes model providers or includes uploaded content.
 */
export async function evaluateOperations(
  now: Date,
  thresholds: AlertThresholds,
  database: AlertDatabase = prisma as unknown as AlertDatabase,
): Promise<OperationsSnapshot> {
  const from = new Date(now.getTime() - DAY_MS);
  const failureFrom = new Date(
    now.getTime() - thresholds.failureLookbackMinutes * MINUTE_MS,
  );
  const [jobs, leases] = await Promise.all([
    database.job.findMany({
      where: {
        OR: [
          // Queue and running/expired jobs are never hidden by a time window:
          // a multi-day outage must remain visible until an operator fixes it.
          { status: { in: [...RUNNING_STATUSES, "QUEUED"] } },
          {
            status: { in: [...TERMINAL_STATUSES] },
            OR: [
              { completedAt: { gte: failureFrom } },
              { completedAt: null, updatedAt: { gte: failureFrom } },
            ],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        claimedBy: true,
        leaseUntil: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        stageStates: true,
      },
    }),
    database.rateLimitBucket.findMany({
      where: { key: { startsWith: "worker-lease:" } },
      select: { key: true, resetAt: true },
    }),
  ]);

  const queued = jobs.filter(
    (job) => job.status === "QUEUED" && !isActiveLease(job, now),
  );
  const running = jobs.filter(
    (job) =>
      (RUNNING_STATUSES as readonly string[]).includes(job.status) &&
      isActiveLease(job, now),
  );
  const stalled = jobs.filter(
    (job) =>
      (RUNNING_STATUSES as readonly string[]).includes(job.status) &&
      !isActiveLease(job, now),
  );
  const backlog = [...queued, ...stalled];
  const terminalFailures = jobs.filter(
    (job) =>
      (job.status === "FAILED" || job.status === "PARTIAL") &&
      (job.completedAt ?? job.updatedAt) >= failureFrom,
  );
  const active = jobs.filter((job) => isActiveLease(job, now));
  const newestClaim = active.reduce<Date | null>(
    (latest, job) =>
      job.leaseUntil && (!latest || job.leaseUntil > latest) ? job.leaseUntil : latest,
    null,
  );
  const claimedAt = newestClaim
    ? new Date(newestClaim.getTime() - LEASE_MS)
    : null;
  const leaseObservedAt = leases
    .map((lease) => ({ key: lease.key, observedAt: new Date(lease.resetAt.getTime() - 2 * MINUTE_MS) }))
    .reduce<Date | null>(
      (latest, lease) => (!latest || lease.observedAt > latest ? lease.observedAt : latest),
      null,
    );
  const lastWorkerClaimAt =
    claimedAt && (!leaseObservedAt || claimedAt > leaseObservedAt)
      ? claimedAt
      : leaseObservedAt;
  const workerHeartbeatAt = leases
    .filter((lease) => lease.resetAt > now)
    .reduce<Date | null>(
      (latest, lease) => {
        const observedAt = new Date(lease.resetAt.getTime() - 2 * MINUTE_MS);
        return !latest || observedAt > latest ? observedAt : latest;
      },
      null,
    );
  const oldestQueuedAt = backlog.reduce<Date | null>(
    (oldest, job) => (!oldest || job.createdAt < oldest ? job.createdAt : oldest),
    null,
  );
  const oldestQueueAgeMinutes = oldestQueuedAt
    ? roundedMinutes(now.getTime() - oldestQueuedAt.getTime())
    : null;
  const alerts: OperationsSnapshot["alerts"] = [];

  const heartbeatAgeMinutes = workerHeartbeatAt
    ? roundedMinutes(now.getTime() - workerHeartbeatAt.getTime())
    : null;
  if (
    backlog.length > 0 &&
    (heartbeatAgeMinutes === null ||
      heartbeatAgeMinutes > thresholds.claimAgeMinutes)
  ) {
    alerts.push({
      code: "WORKER_STALE",
      severity: "critical",
      message:
        heartbeatAgeMinutes === null
          ? "No active worker heartbeat while jobs are waiting"
          : `No active worker heartbeat for ${heartbeatAgeMinutes} minutes while jobs are waiting`,
    });
  }

  if (
    oldestQueueAgeMinutes !== null &&
    oldestQueueAgeMinutes > thresholds.queueAgeMinutes
  ) {
    alerts.push({
      code: "QUEUE_OLDEST",
      severity: "warning",
      message: `Oldest waiting job is ${oldestQueueAgeMinutes} minutes old`,
    });
  }

  for (const job of running) {
    const attemptStartedAt = activeAttemptStartedAt(job) ?? job.updatedAt;
    const runtimeMinutes = roundedMinutes(now.getTime() - attemptStartedAt.getTime());
    if (runtimeMinutes > thresholds.jobRuntimeMinutes) {
      alerts.push({
        code: "JOB_STUCK",
        severity: "warning",
        message: `Job ${job.id} has been running for ${runtimeMinutes} minutes`,
      });
    }
  }

  for (const job of terminalFailures) {
    alerts.push({
      code: "JOB_FAILED",
      severity: "warning",
      message: `Job ${job.id} ended as ${job.status}`,
    });
  }

  return {
    generatedAt: now.toISOString(),
    window: { from: from.toISOString(), to: now.toISOString() },
    thresholds,
    healthy: alerts.every((alert) => alert.code !== "WORKER_STALE"),
    workers: {
      active: leases.filter((lease) => lease.resetAt > now).length,
      renewedRecently: leases.filter(
        (lease) =>
          lease.resetAt > now &&
          now.getTime() - (lease.resetAt.getTime() - 2 * MINUTE_MS) <=
            thresholds.claimAgeMinutes * MINUTE_MS,
      ).length,
    },
    counts: {
      queued: queued.length,
      running: running.length,
      terminalFailures: terminalFailures.length,
    },
    oldestQueueAgeMinutes,
    lastWorkerClaimAt: lastWorkerClaimAt?.toISOString() ?? null,
    alerts,
  };
}

/** Read the current running stage's start without relying on job createdAt. */
function activeAttemptStartedAt(job: JobSignal): Date | null {
  if (!Array.isArray(job.stageStates)) {
    return null;
  }
  let latest: Date | null = null;
  for (const value of job.stageStates) {
    if (!value || typeof value !== "object") continue;
    const state = value as { status?: unknown; startedAt?: unknown };
    if (state.status !== "RUNNING" || typeof state.startedAt !== "string") continue;
    const startedAt = new Date(state.startedAt);
    if (!Number.isNaN(startedAt.getTime()) && (!latest || startedAt > latest)) {
      latest = startedAt;
    }
  }
  return latest;
}
