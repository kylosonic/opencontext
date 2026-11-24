import { RETENTION } from "@kylosonic/opencontext-schemas";

const MAX_RETENTION_DAYS = 3_650;

function boundedDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_RETENTION_DAYS
    ? parsed
    : fallback;
}

/** Configured retention windows (days), honoring RETENTION_*_DAYS overrides. */
export function retentionDaysFromEnv(
  env: Record<string, string | undefined> = process.env,
): { completedDays: number; incompleteDays: number } {
  return {
    completedDays: boundedDays(env.RETENTION_COMPLETED_DAYS, RETENTION.completedDays),
    incompleteDays: boundedDays(env.RETENTION_INCOMPLETE_DAYS, RETENTION.incompleteDays),
  };
}

/**
 * Retention rules (jobs.md B9): completed jobs keep media and results for
 * 14 days from completion (or RETENTION_COMPLETED_DAYS); jobs that never
 * completed keep artifacts for 7 days from creation (or RETENTION_INCOMPLETE_DAYS).
 */
export function computeExpiresAt(completedAt: Date | null, createdAt: Date): Date {
  const base = completedAt ?? createdAt;
  const { completedDays, incompleteDays } = retentionDaysFromEnv();
  const days = completedAt ? completedDays : incompleteDays;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Human retention sentence shown on every job page (B9). */
export function retentionNoteFor(completedAt: Date | null): string {
  const { completedDays, incompleteDays } = retentionDaysFromEnv();
  return completedAt
    ? `Completed jobs are kept for ${completedDays} days; this job will be removed automatically.`
    : `Unfinished jobs are kept for ${incompleteDays} days; this job will be removed automatically.`;
}
