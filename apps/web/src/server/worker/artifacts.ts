import type { Job } from "@prisma/client";
import type { MediaKind } from "@opencontext/schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { LEASE_MS } from "@/server/queue";

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
  const key = `jobs/${job.id}/artifacts/${input.kind.toLowerCase()}/${timestamp}.${extension}`;

  await storage.put(key, input.body, {
    contentType: input.mime,
    sizeBytes: input.sizeBytes,
  });

  const existing = await prisma.media.findFirst({
    where: { jobId: job.id, kind: input.kind, timestampSec: input.timestampSec ?? null },
  });

  const media = existing
    ? await prisma.media.update({
        where: { id: existing.id },
        data: { key, mime: input.mime, sizeBytes: input.sizeBytes },
      })
    : await prisma.media.create({
        data: {
          jobId: job.id,
          kind: input.kind,
          key,
          mime: input.mime,
          sizeBytes: input.sizeBytes,
          timestampSec: input.timestampSec,
        },
      });

  // Renew the lease: artifact uploads happen inside active stage work.
  await prisma.job.update({
    where: { id: job.id },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });

  return { key, mediaId: media.id };
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
