import { randomUUID } from "node:crypto";
import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { notifyWorkerJobQueued } from "@/server/queue/dispatchWorker";
import { storage } from "@/server/storage";
import { canContributeToWorkspace, canManageJob } from "@/server/workspaces";
import { initialStageStates } from "./progress";
import { jobToSummary } from "./serialize";

const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);

export type RerunJobResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "NOT_READY" }
  | { kind: "NO_SOURCE" }
  | { kind: "OK"; job: ReturnType<typeof jobToSummary> };

/**
 * Re-run a terminal job at a new detail level by cloning its SOURCE objects
 * under a fresh queued jobId so deletion or expiry of one job never removes
 * source bytes needed by the other.
 */
export async function rerunJob(
  jobId: string,
  userId: string,
  detailLevel: DetailLevel,
): Promise<RerunJobResult> {
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      media: {
        where: { kind: "SOURCE" },
        orderBy: { timestampSec: "asc" },
      },
      workspace: { select: { name: true } },
    },
  });
  if (!existing) return { kind: "NOT_FOUND" };
  if (!(await canManageJob(existing, userId, "jobs:rerun"))) {
    return { kind: "FORBIDDEN" };
  }
  if (
    existing.workspaceId &&
    !(await canContributeToWorkspace(existing.workspaceId, userId))
  ) {
    return { kind: "FORBIDDEN" };
  }
  if (!TERMINAL_STATUSES.has(existing.status)) {
    return { kind: "NOT_READY" };
  }

  const sources =
    existing.media.length > 0
      ? existing.media
      : existing.sourceKey
        ? [
            {
              key: existing.sourceKey,
              mime: null as string | null,
              sizeBytes: existing.sourceSize ?? 0,
              timestampSec: 0 as number | null,
            },
          ]
        : [];
  if (sources.length === 0) {
    return { kind: "NO_SOURCE" };
  }

  for (const source of sources) {
    const head = await storage.head(source.key);
    if (!head) return { kind: "NO_SOURCE" };
  }

  const newJobId = randomUUID();
  const stageStates = initialStageStates();
  const fallbackExt = existing.sourceExt ?? "bin";
  const newKeys = sources.map((source, index) => {
    const dot = source.key.lastIndexOf(".");
    const ext = dot >= 0 ? source.key.slice(dot + 1).toLowerCase() : fallbackExt;
    return sources.length === 1
      ? `jobs/${newJobId}/source.${ext}`
      : `jobs/${newJobId}/sources/${String(index + 1).padStart(2, "0")}.${ext}`;
  });

  const copiedKeys: string[] = [];
  try {
    for (let index = 0; index < sources.length; index += 1) {
      await storage.copy(sources[index].key, newKeys[index]);
      copiedKeys.push(newKeys[index]);
    }

    const created = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          id: newJobId,
          userId,
          workspaceId: existing.workspaceId,
          displayName: existing.displayName,
          detailLevel,
          status: "QUEUED",
          stageStates,
          sourceKey: newKeys[0],
          sourceSize: existing.sourceSize ?? sources[0].sizeBytes,
          sourceExt: existing.sourceExt,
          assetCount: existing.assetCount ?? sources.length,
        },
      });
      for (let index = 0; index < sources.length; index += 1) {
        await tx.media.create({
          data: {
            jobId: job.id,
            kind: "SOURCE",
            key: newKeys[index],
            mime: sources[index].mime,
            sizeBytes: sources[index].sizeBytes,
            timestampSec: index,
          },
        });
      }
      return job;
    });

    await notifyWorkerJobQueued(created.id);
    return {
      kind: "OK",
      job: jobToSummary(created, true, existing.workspace?.name ?? null),
    };
  } catch (error) {
    await Promise.all(
      copiedKeys.map((key) => storage.delete(key).catch(() => undefined)),
    );
    await prisma.job.deleteMany({ where: { id: newJobId } });
    throw error;
  }
}
