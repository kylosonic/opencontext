import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { initialStageStates } from "./progress";

export interface CreateJobInput {
  userId: string;
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
  displayName: string;
  detailLevel: DetailLevel;
  sources: CreateJobSource[];
}

/**
 * Upload commit sequence (blueprint §3 B3): create Job + SOURCE Media and
 * move the temp object to its final key inside one transaction. Any failure
 * rolls the rows back and removes the temp object — partial data never
 * enters processing. Final key: `jobs/{jobId}/source.{ext}`.
 */
export async function createJob(input: CreateJobInput) {
  return createJobSources({
    userId: input.userId,
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
  const finalizedKeys: string[] = [];
  let createdJobId: string | null = null;
  try {
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          userId: input.userId,
          displayName: input.displayName,
          detailLevel: input.detailLevel,
          status: "QUEUED",
          stageStates,
          sourceSize: primary.sizeBytes,
          sourceExt: primary.extension,
          assetCount: input.sources.length,
        },
      });

      const finalKeys: string[] = [];
      for (let index = 0; index < input.sources.length; index += 1) {
        const source = input.sources[index];
        const finalKey =
          input.sources.length === 1
            ? `jobs/${created.id}/source.${source.extension}`
            : `jobs/${created.id}/sources/${String(index + 1).padStart(2, "0")}.${source.extension}`;
        await tx.media.create({
          data: {
            jobId: created.id,
            kind: "SOURCE",
            key: finalKey,
            mime: source.mime,
            sizeBytes: source.sizeBytes,
            timestampSec: index,
          },
        });
        finalKeys.push(finalKey);
      }
      return tx.job.update({
        where: { id: created.id },
        data: { sourceKey: finalKeys[0] },
      });
    });
    createdJobId = job.id;

    for (let index = 0; index < input.sources.length; index += 1) {
      const source = input.sources[index];
      const finalKey =
        input.sources.length === 1
          ? `jobs/${job.id}/source.${source.extension}`
          : `jobs/${job.id}/sources/${String(index + 1).padStart(2, "0")}.${source.extension}`;
      await storage.move(source.tempKey, finalKey, { etag: source.etag });
      finalizedKeys.push(finalKey);
    }
    return job;
  } catch (error) {
    // Best-effort cleanup for both unmoved intents and generated final keys.
    await Promise.all([
      ...input.sources.map((source) =>
        storage.delete(source.tempKey).catch(() => undefined),
      ),
      ...finalizedKeys.map((key) => storage.delete(key).catch(() => undefined)),
    ]);
    if (createdJobId) {
      await prisma.job.deleteMany({ where: { id: createdJobId } });
    }
    throw error;
  }
}
