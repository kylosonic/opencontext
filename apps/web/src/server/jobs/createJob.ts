import { randomUUID } from "node:crypto";
import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { notifyWorkerJobQueued } from "@/server/queue/dispatchWorker";
import { storage } from "@/server/storage";
import { initialStageStates } from "./progress";

export interface CreateJobInput {
  userId: string;
  workspaceId?: string;
  /** Already sanitized by `src/server/validation/upload.ts` (upload.md B6). */
  displayName: string;
  detailLevel: DetailLevel;
  /** Extension without the dot, lowercase (e.g. "mp4"). */
  sourceExt: string;
  sourceSize: number;
  sourceMime: string;
  /** Temporary object key the upload was streamed to (e.g. `incoming/<uuid>`). */
  tempKey: string;
  etag?: string;
}

export interface CreateJobSource {
  extension: string;
  sizeBytes: number;
  mime: string;
  tempKey: string;
  filename: string;
  etag?: string;
}

export interface CreateJobSourcesInput {
  userId: string;
  workspaceId?: string;
  displayName: string;
  detailLevel: DetailLevel;
  sources: CreateJobSource[];
}

/**
 * Upload commit sequence (blueprint §3 B3): move every temp object to its
 * final key first, then create Job + SOURCE Media in one transaction. A
 * worker can never observe a QUEUED row while the source is still missing.
 * Any failure removes both the temp and already-finalized objects. Final
 * key: `jobs/{jobId}/source.{ext}`.
 */
export async function createJob(input: CreateJobInput) {
  return createJobSources({
    userId: input.userId,
    workspaceId: input.workspaceId,
    displayName: input.displayName,
    detailLevel: input.detailLevel,
    sources: [
      {
        filename: input.displayName,
        extension: input.sourceExt,
        sizeBytes: input.sourceSize,
        mime: input.sourceMime,
        tempKey: input.tempKey,
        etag: input.etag,
      },
    ],
  });
}

/**
 * Commit one or more source objects as one ordered job. The first source
 * remains the legacy primary `Job.source*` value while every source gets a
 * SOURCE Media row. This keeps existing single-video jobs compatible and
 * lets image sets share one analysis and context.
 */
export async function createJobSources(input: CreateJobSourcesInput) {
  if (input.sources.length === 0) {
    throw new Error("A job requires at least one source");
  }
  const stageStates = initialStageStates();
  const primary = input.sources[0];
  // Generate the id before inserting the QUEUED row so final object keys are
  // known and every source can be moved while the job remains unclaimable.
  const jobId = randomUUID();
  const finalKeys = input.sources.map((source, index) =>
    input.sources.length === 1
      ? `jobs/${jobId}/source.${source.extension}`
      : `jobs/${jobId}/sources/${String(index + 1).padStart(2, "0")}.${source.extension}`,
  );
  const finalizedKeys: string[] = [];
  try {
    for (let index = 0; index < input.sources.length; index += 1) {
      await storage.move(input.sources[index].tempKey, finalKeys[index], {
        etag: input.sources[index].etag,
      });
      finalizedKeys.push(finalKeys[index]);
    }

    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          id: jobId,
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          displayName: input.displayName,
          detailLevel: input.detailLevel,
          status: "QUEUED",
          stageStates,
          sourceSize: primary.sizeBytes,
          sourceExt: primary.extension,
          assetCount: input.sources.length,
        },
      });

      for (let index = 0; index < input.sources.length; index += 1) {
        const source = input.sources[index];
        await tx.media.create({
          data: {
            jobId: created.id,
            kind: "SOURCE",
            key: finalKeys[index],
            mime: source.mime,
            sizeBytes: source.sizeBytes,
            timestampSec: index,
          },
        });
      }
      return tx.job.update({
        where: { id: created.id },
        data: { sourceKey: finalKeys[0] },
      });
    });
    await notifyWorkerJobQueued(job.id);
    return job;
  } catch (error) {
    // Best-effort cleanup for both unmoved intents and generated final keys.
    await Promise.all([
      ...input.sources.map((source) =>
        storage.delete(source.tempKey).catch(() => undefined),
      ),
      ...finalizedKeys.map((key) => storage.delete(key).catch(() => undefined)),
    ]);
    // If the transaction committed but a later operation failed, remove the
    // row as well. deleteMany keeps cleanup idempotent when creation failed.
    await prisma.job.deleteMany({ where: { id: jobId } });
    throw error;
  }
}
