import type { Prisma } from "@prisma/client";
import type { StageState } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { computeProgress } from "@/server/jobs/progress";

/**
 * Queue constants (ADR-0001). The lease is the visibility timeout:
 * workers renew it on every progress report and through a periodic heartbeat;
 * an expired lease makes the job claimable again (the claim query itself
 * handles re-release — no sweep needed).
 */
export const LEASE_MS = 5 * 60 * 1000;
export const BACKOFF_MS = [2_000, 8_000] as const;
/** Auto-retry budget for transient failures (jobs.md B7, blueprint §4). */
export const QUEUE_MAX_ATTEMPTS = 5;
/** Provider quota windows may legitimately span several queue attempts. */
export const RATE_LIMIT_MAX_ATTEMPTS = 40;
const CLAIMABLE_STATUSES = [
  "QUEUED",
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
] as const;

/** Portable claimability predicates (no SKIP LOCKED per ADR-0003). */
function claimConditions(now: Date): Prisma.JobWhereInput {
  return {
    status: { in: [...CLAIMABLE_STATUSES] },
    OR: [
      { claimedBy: null },
      { leaseUntil: null },
      { leaseUntil: { lte: now } },
    ],
    AND: [
      { OR: [{ availableAt: null }, { availableAt: { lte: now } }] },
      {
        OR: [
          { attempts: { lt: QUEUE_MAX_ATTEMPTS } },
          {
            // A provider-quota deferral is marked TRANSIENT while queued so it
            // can use the larger bounded quota window without weakening the
            // ordinary poison-job limit.
            attempts: { lt: RATE_LIMIT_MAX_ATTEMPTS },
            failureKind: "TRANSIENT",
          },
        ],
      },
    ],
  };
}

export interface ClaimInput {
  workerId: string;
}

/**
 * Atomic lease claim. Portability pattern (ADR-0001): select candidates
 * (oldest first), conditionally update each with `updateMany`, then
 * re-read and verify the claim actually landed (guards against races
 * between the select and the update). Returns the claimed job row or
 * null when the queue is idle.
 */
export async function claimJob(input: ClaimInput) {
  const now = new Date();
  await failExhaustedJobs(now);
  const candidates = await prisma.job.findMany({
    where: claimConditions(now),
    orderBy: { createdAt: "asc" },
    // A small fixed head-of-line window let a handful of contenders starve
    // every later item. Exhausted attempts are removed above before this
    // portable candidate scan.
    take: 25,
    select: { id: true },
  });

  for (const candidate of candidates) {
    const claimed = await prisma.job.updateMany({
      where: {
        id: candidate.id,
        ...claimConditions(now),
      },
      data: {
        claimedBy: input.workerId,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        availableAt: null,
        // TRANSIENT grants a larger quota window while queued. Once a worker
        // successfully claims the job, normal poison-job accounting resumes;
        // a crash cannot inherit the provider-quota budget indefinitely.
        failureKind: "NONE",
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      continue; // lost a race; try the next candidate
    }
    const job = await prisma.job.findUnique({ where: { id: candidate.id } });
    if (
      job &&
      job.claimedBy === input.workerId &&
      (CLAIMABLE_STATUSES as readonly string[]).includes(job.status)
    ) {
      return job;
    }
  }
  return null;
}

async function failExhaustedJobs(now: Date): Promise<void> {
  const exhausted = await prisma.job.findMany({
    where: {
      status: { in: [...CLAIMABLE_STATUSES] },
      AND: [
        {
          OR: [
            {
              attempts: { gte: QUEUE_MAX_ATTEMPTS },
              failureKind: { not: "TRANSIENT" },
            },
            { attempts: { gte: RATE_LIMIT_MAX_ATTEMPTS } },
          ],
        },
        {
          OR: [
            { claimedBy: null },
            { leaseUntil: null },
            { leaseUntil: { lte: now } },
          ],
        },
      ],
    },
    select: { id: true, status: true, stageStates: true, failureKind: true },
    take: 100,
  });
  for (const job of exhausted) {
    const stageStates = ((job.stageStates as StageState[] | null) ?? []).map(
      (state) =>
        state.status === "RUNNING"
          ? {
              ...state,
              status: "FAILED" as const,
              completedAt: now.toISOString(),
              error: "Automatic retry budget exhausted",
            }
          : state,
    );
    const completedStage = stageStates.some(
      (state) => state.status === "SUCCEEDED" || state.status === "SKIPPED",
    );
    const runningStage = stageStates.find((state) => state.status === "FAILED");
    const errorStage =
      runningStage?.stage ??
      (job.status === "TRANSCRIBING" ||
      job.status === "ANALYZING" ||
      job.status === "AGGREGATING" ||
      job.status === "GENERATING_CONTEXT" ||
      job.status === "EXTRACTING"
        ? job.status
        : "EXTRACTING");
    const failed = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: { in: [...CLAIMABLE_STATUSES] },
        AND: [
          {
            OR: [
              {
                attempts: { gte: QUEUE_MAX_ATTEMPTS },
                failureKind: { not: "TRANSIENT" },
              },
              { attempts: { gte: RATE_LIMIT_MAX_ATTEMPTS } },
            ],
          },
          {
            OR: [
              { claimedBy: null },
              { leaseUntil: null },
              { leaseUntil: { lte: now } },
            ],
          },
        ],
      },
      data: {
        status: completedStage ? "PARTIAL" : "FAILED",
        progress: computeProgress(stageStates),
        error: "Automatic retry budget exhausted",
        errorStage: errorStage as never,
        failureKind: "TRANSIENT",
        stageStates,
        claimedBy: null,
        leaseUntil: null,
        availableAt: null,
      },
    });
    if (failed.count > 0) {
      continue;
    }
  }
}

/** The claimability predicate exported for tests. */
export function isClaimable(
  job: {
    status: string;
    claimedBy: string | null;
    leaseUntil: Date | null;
    availableAt: Date | null;
    attempts?: number;
    failureKind?: string;
  },
  now: Date = new Date(),
): boolean {
  if (!(CLAIMABLE_STATUSES as readonly string[]).includes(job.status)) {
    return false;
  }
  const attempts = job.attempts ?? 0;
  const maxAttempts =
    job.failureKind === "TRANSIENT"
      ? RATE_LIMIT_MAX_ATTEMPTS
      : QUEUE_MAX_ATTEMPTS;
  if (attempts >= maxAttempts) {
    return false;
  }
  const leaseFree =
    job.claimedBy === null || job.leaseUntil === null || job.leaseUntil <= now;
  const available =
    job.availableAt === null || job.availableAt <= now;
  return leaseFree && available;
}
