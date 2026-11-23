import type { Job } from "@prisma/client";
import type { MediaKind } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { activeLease, LeaseLostError, renewedLease } from "@/server/queue";

export interface StoreArtifactInput {
  kind: MediaKind;
  /** Frame timestamp (frames only); artifacts without one use null → "0". */
  timestampSec?: number;
  /** Original upload filename — only its extension is used for the key. */
  filename: string;
  mime?: string;
  sizeBytes: number;
  body: ReadableStream<Uint8Array>;
}

export interface StoredArtifact {
  key: string;
  mediaId: string;
}

/**
 * POST /api/worker/jobs/[id]/artifacts — store a binary artifact (audio,
 * frames) and register a Media row (refs only, ADR-0004). The key is
 * deterministic per (kind, timestampSec) so re-uploads are idempotent
 * (blueprint §4 resume idempotency).
 */
export async function storeArtifact(
  job: Job,
  input: StoreArtifactInput,
): Promise<StoredArtifact> {
  const extension = sanitizeExtension(input.filename) ?? "bin";
  const timestamp = input.timestampSec ?? 0;
  const timestampSec = input.timestampSec ?? null;
  const key = `jobs/${job.id}/artifacts/${input.kind.toLowerCase()}/${timestamp}.${extension}`;
  const workerId = job.claimedBy;
  if (!workerId) {
    throw new LeaseLostError(job.id);
  }

  // Renew before touching the blob, then fence again after the transfer.
  // A stalled worker must not write into a job reclaimed by another one.
  const initialNow = new Date();
  const renewed = await prisma.job.updateMany({
    where: { id: job.id, ...activeLease(workerId, initialNow) },
    data: { leaseUntil: renewedLease(initialNow) },
  });
  if (renewed.count === 0) {
    throw new LeaseLostError(job.id);
  }

  await storage.put(key, input.body, {
    contentType: input.mime,
    sizeBytes: input.sizeBytes,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const fenced = await tx.job.updateMany({
        where: { id: job.id, ...activeLease(workerId, now) },
        data: { leaseUntil: renewedLease(now) },
      });
      if (fenced.count === 0) {
        throw new LeaseLostError(job.id);
      }
      const media = await tx.media.upsert({
        where: { jobId_key: { jobId: job.id, key } },
        create: {
          jobId: job.id,
          kind: input.kind,
          key,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
          timestampSec,
        },
        update: {
          kind: input.kind,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
          timestampSec,
        },
      });
      return { key, mediaId: media.id };
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

function sanitizeExtension(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) {
    return undefined;
  }
  const raw = filename.slice(dot + 1).toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]/g, "").slice(0, 10);
  return cleaned === "" ? undefined : cleaned;
}
