import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { canManageJob } from "@/server/workspaces";

export type DeleteJobResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

/**
 * Delete a job (jobs.md B10): remove every stored object (source,
 * artifacts, frames) then cascade-delete the rows. We first revoke any
 * active worker lease in a transaction, so late artifact/stage mutations are
 * fenced before their objects can be collected. Storage removal is
 * best-effort — the database rows always go.
 */
export async function deleteJob(jobId: string, userId: string): Promise<DeleteJobResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { kind: "NOT_FOUND" };
  if (!(await canManageJob(job, userId, "jobs:delete"))) return { kind: "FORBIDDEN" };

  const deletion = await prisma.$transaction(async (tx) => {
    const revoked = await tx.job.updateMany({
      where: { id: jobId },
      data: {
        status: "FAILED",
        failureKind: "PERMANENT",
        error: "This job is being deleted",
        claimedBy: null,
        leaseUntil: null,
        availableAt: null,
      },
    });
    if (revoked.count === 0) return null;
    return tx.job.findUnique({
      where: { id: jobId },
      include: { media: { select: { key: true } } },
    });
  });
  if (!deletion) return { kind: "NOT_FOUND" };

  const keys = new Set<string>();
  if (deletion.sourceKey) {
    keys.add(deletion.sourceKey);
  }
  for (const media of deletion.media) {
    keys.add(media.key);
  }

  await storage.deleteMany([...keys]).catch(() => undefined);
  // deleteMany makes concurrent/replayed deletion idempotent instead of
  // surfacing Prisma P2025 as a 500.
  await prisma.job.deleteMany({ where: { id: jobId } });

  return { kind: "OK" };
}
