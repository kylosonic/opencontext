import { prisma } from "@/server/db/prisma";

/**
 * Queue constants (ADR-0001). The lease is the visibility timeout:
 * workers renew it on every progress report; an expired lease makes the
 * job claimable again (the claim query itself handles re-release — no
 * sweep needed).
 */
export const LEASE_MS = 5 * 60 * 1000;
export const BACKOFF_MS = [2_000, 8_000] as const;
/** Auto-retry budget for transient failures (jobs.md B7, blueprint §4). */
export const QUEUE_MAX_ATTEMPTS = 2;

/** Portable claimability predicates (no SKIP LOCKED per ADR-0003). */
function claimConditions(now: Date) {
  return {
    status: "QUEUED" as const,
    OR: [
      { claimedBy: null },
      { leaseUntil: null },
      { leaseUntil: { lte: now } },
    ],
    AND: [{ OR: [{ availableAt: null }, { availableAt: { lte: now } }] }],
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
  const candidates = await prisma.job.findMany({
    where: claimConditions(now),
    orderBy: { createdAt: "asc" },
    take: 5,
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
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      continue; // lost a race; try the next candidate
    }
    const job = await prisma.job.findUnique({ where: { id: candidate.id } });
    if (job && job.claimedBy === input.workerId && job.status === "QUEUED") {
      return job;
    }
  }
  return null;
}

/** The claimability predicate exported for tests. */
export function isClaimable(
  job: {
    status: string;
    claimedBy: string | null;
    leaseUntil: Date | null;
    availableAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (job.status !== "QUEUED") {
    return false;
  }
  const leaseFree =
    job.claimedBy === null || job.leaseUntil === null || job.leaseUntil <= now;
  const available =
    job.availableAt === null || job.availableAt <= now;
  return leaseFree && available;
}
