import { RETENTION } from "@opencontext/schemas";

/**
 * Retention rules (jobs.md B9): completed jobs keep media and results for
 * 14 days from completion; jobs that never completed keep artifacts for
 * 7 days from creation. The removal is automatic and silent.
 */
export function computeExpiresAt(completedAt: Date | null, createdAt: Date): Date {
  const base = completedAt ?? createdAt;
  const days = completedAt ? RETENTION.completedDays : RETENTION.incompleteDays;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Human retention sentence shown on every job page (B9). */
export function retentionNoteFor(completedAt: Date | null): string {
  return completedAt
    ? `Completed jobs are kept for ${RETENTION.completedDays} days; this job will be removed automatically.`
    : `Unfinished jobs are kept for ${RETENTION.incompleteDays} days; this job will be removed automatically.`;
}
