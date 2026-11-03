import type { DetailLevel } from "@opencontext/schemas";
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
}

/**
 * Upload commit sequence (blueprint §3 B3): create Job + SOURCE Media and
 * move the temp object to its final key inside one transaction. Any failure
 * rolls the rows back and removes the temp object — partial data never
 * enters processing. Final key: `jobs/{jobId}/source.{ext}`.
 */
export async function createJob(input: CreateJobInput) {
  const stageStates = initialStageStates();
  try {
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          userId: input.userId,
          displayName: input.displayName,
          detailLevel: input.detailLevel,
          status: "QUEUED",
          stageStates,
          sourceSize: input.sourceSize,
          sourceExt: input.sourceExt,
        },
      });

      const finalKey = `jobs/${created.id}/source.${input.sourceExt}`;

      await tx.media.create({
        data: {
          jobId: created.id,
          kind: "SOURCE",
          key: finalKey,
          mime: input.sourceMime,
          sizeBytes: input.sourceSize,
        },
      });

      // Storage move inside the transaction: a failure here rolls the DB
      // rows back so no job can reference a missing source object.
      await storage.move(input.tempKey, finalKey);

      return tx.job.update({
        where: { id: created.id },
        data: { sourceKey: finalKey },
      });
    });
    return job;
  } catch (error) {
    // Best-effort temp cleanup; the transaction already rolled back.
    await storage.delete(input.tempKey).catch(() => undefined);
    throw error;
  }
}
