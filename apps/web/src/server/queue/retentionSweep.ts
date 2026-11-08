import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export interface RetentionSweepResult {
  scanned: number;
  deleted: number;
}

/**
 * Retention sweeper (jobs.md B9; trigger: POST /api/admin/retention-sweep).
 * Completed jobs expire 14 days after completion; jobs that never
 * completed expire 7 days after creation. Removes stored objects first,
 * then the rows. Idempotent — a second sweep finds nothing.
 */
export async function retentionSweep(): Promise<RetentionSweepResult> {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const completedCutoff = new Date(now - 14 * DAY);
  const incompleteCutoff = new Date(now - 7 * DAY);

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
  });

  let deleted = 0;
  for (const job of expired) {
    const keys = new Set<string>();
    if (job.sourceKey) {
      keys.add(job.sourceKey);
    }
    for (const media of job.media) {
      keys.add(media.key);
    }
    await storage.deleteMany([...keys]).catch(() => undefined);
    await prisma.job.delete({ where: { id: job.id } });
    deleted += 1;
  }

  const expiredIntents = await prisma.uploadIntent.findMany({
    where: { expiresAt: { lte: new Date(now) } },
    select: { id: true, tempKey: true },
  });
  for (const intent of expiredIntents) {
    await storage.delete(intent.tempKey).catch(() => undefined);
    await prisma.uploadIntent.delete({ where: { id: intent.id } });
    deleted += 1;
  }

  await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date(now - DAY) } },
  });

  return { scanned: expired.length + expiredIntents.length, deleted };
}
