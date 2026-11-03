import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export type DeleteJobResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

/**
 * Delete a job (jobs.md B10): remove every stored object (source,
 * artifacts, frames) then cascade-delete the rows. Storage removal is
 * best-effort — the database rows always go.
 */
export async function deleteJob(jobId: string, userId: string): Promise<DeleteJobResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { media: { select: { key: true } } },
  });
  if (!job) {
    return { kind: "NOT_FOUND" };
  }
  if (job.userId !== userId) {
    return { kind: "FORBIDDEN" };
  }

  const keys = new Set<string>();
  if (job.sourceKey) {
    keys.add(job.sourceKey);
  }
  for (const media of job.media) {
    keys.add(media.key);
  }

  await storage.deleteMany([...keys]).catch(() => undefined);
  await prisma.job.delete({ where: { id: jobId } });

  return { kind: "OK" };
}
