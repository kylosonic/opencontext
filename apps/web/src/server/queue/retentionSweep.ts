import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export interface RetentionSweepResult {
  scanned: number;
  deleted: number;
}

/**
 * Retention sweeper (jobs.md B9; trigger: POST /api/admin/retention-sweep).
 * Completed and incomplete jobs use separately configurable expiry windows
 * (14 and 7 days by default). Removes stored objects first, then the rows.
 * Idempotent — a second sweep finds nothing.
 */
export async function retentionSweep(): Promise<RetentionSweepResult> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const completedDays = positiveInteger(
    process.env.RETENTION_COMPLETED_DAYS,
    14,
  );
  const incompleteDays = positiveInteger(
    process.env.RETENTION_INCOMPLETE_DAYS,
    7,
  );
  const completedCutoff = new Date(now - completedDays * DAY);
  const incompleteCutoff = new Date(now - incompleteDays * DAY);

  let scanned = 0;
  let deleted = 0;
  while (true) {
    const expired = await prisma.job.findMany({
      where: {
        OR: [
          { completedAt: { lte: completedCutoff } },
          { completedAt: null, createdAt: { lte: incompleteCutoff } },
        ],
      },
      select: {
        id: true,
        sourceKey: true,
        media: { select: { key: true } },
      },
      take: 500,
    });
    scanned += expired.length;
    let batchProgress = false;
    for (const job of expired) {
      const keys = new Set<string>();
      if (job.sourceKey) keys.add(job.sourceKey);
      for (const media of job.media) keys.add(media.key);
      try {
        await storage.deleteMany([...keys]);
      } catch (error) {
        console.error("Retention object deletion failed; retrying next sweep", error);
        continue;
      }
      const result = await prisma.job.deleteMany({ where: { id: job.id } });
      deleted += result.count;
      batchProgress ||= result.count > 0;
    }
    if (expired.length < 500 || !batchProgress) break;
  }

  while (true) {
    const expiredIntents = await prisma.uploadIntent.findMany({
      where: { expiresAt: { lte: new Date(now) } },
      select: { id: true, tempKey: true },
      take: 500,
    });
    scanned += expiredIntents.length;
    let batchProgress = false;
    for (const intent of expiredIntents) {
      try {
        await storage.delete(intent.tempKey);
      } catch (error) {
        console.error("Retention temp deletion failed; retrying next sweep", error);
        continue;
      }
      const result = await prisma.uploadIntent.deleteMany({
        where: { id: intent.id },
      });
      deleted += result.count;
      batchProgress ||= result.count > 0;
    }
    if (expiredIntents.length < 500 || !batchProgress) break;
  }

  await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date(now - DAY) } },
  });

  return { scanned, deleted };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
