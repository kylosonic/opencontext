import { randomUUID } from "node:crypto";
import {
  UPLOAD_LIMITS,
  type DetailLevel,
  type ErrorCode,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import {
  createJob,
  createJobSources,
  type CreateJobSource,
} from "@/server/jobs";
import { storage } from "@/server/storage";
import {
  sanitizeDisplayName,
  validateStoredMedia,
  validateUpload,
} from "@/server/validation/upload";

export interface CreateUploadIntentInput {
  userId: string;
  filename: string;
  sizeBytes: number;
  mime?: string;
  detailLevel: DetailLevel;
}

export type CreateUploadIntentResult =
  | {
      kind: "OK";
      uploadId: string;
      method: "PUT";
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    }
  | {
      kind: "INVALID";
      code: ErrorCode;
      message: string;
    };

export async function createUploadIntent(
  input: CreateUploadIntentInput,
): Promise<CreateUploadIntentResult> {
  const validation = validateUpload(input.filename, input.sizeBytes, input.mime);
  if (!validation.ok) {
    return { kind: "INVALID", code: validation.code, message: validation.message };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_LIMITS.intentTtlSec * 1000);
  const expired = await prisma.uploadIntent.findMany({
    where: { userId: input.userId, expiresAt: { lte: now } },
    select: { id: true, tempKey: true },
  });
  if (expired.length > 0) {
    // Delete objects first. If storage fails, keep the rows so retention can
    // retry rather than orphaning the only reference to an incoming blob.
    await storage.deleteMany(expired.map((intent) => intent.tempKey));
    await prisma.uploadIntent.deleteMany({
      where: { id: { in: expired.map((intent) => intent.id) } },
    });
  }

  const tempKey = `incoming/${randomUUID()}.${validation.extension}`;
  const intent = await prisma.uploadIntent.create({
    data: {
      userId: input.userId,
      tempKey,
      filename: sanitizeDisplayName(input.filename),
      sourceExt: validation.extension,
      sizeBytes: input.sizeBytes,
      mime: validation.mime,
      detailLevel: input.detailLevel,
      expiresAt,
    },
  });

  if (storage.provider === "s3") {
    const url = await storage.presignPut(
      tempKey,
      validation.mime,
      input.sizeBytes,
      UPLOAD_LIMITS.intentTtlSec,
    );
    if (!url) {
      await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
      return {
        kind: "INVALID",
        code: "VALIDATION_ERROR",
        message: "Object storage did not return an upload URL",
      };
    }
    return {
      kind: "OK",
      uploadId: intent.id,
      method: "PUT",
      url,
      headers: { "Content-Type": validation.mime },
      expiresAt: expiresAt.toISOString(),
    };
  }

  return {
    kind: "OK",
    uploadId: intent.id,
    method: "PUT",
    url: `/api/uploads/${intent.id}/body`,
    headers: { "Content-Type": validation.mime },
    expiresAt: expiresAt.toISOString(),
  };
}

export type UploadIntentLookup =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "OK"; intent: NonNullable<Awaited<ReturnType<typeof prisma.uploadIntent.findUnique>>> };

export async function getUploadIntent(
  uploadId: string,
  userId: string,
): Promise<UploadIntentLookup> {
  const intent = await prisma.uploadIntent.findUnique({ where: { id: uploadId } });
  if (!intent) {
    return { kind: "NOT_FOUND" };
  }
  if (intent.userId !== userId) {
    return { kind: "FORBIDDEN" };
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    return { kind: "EXPIRED" };
  }
  return { kind: "OK", intent };
}

export async function storeLocalUpload(
  intent: NonNullable<Awaited<ReturnType<typeof prisma.uploadIntent.findUnique>>>,
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
): Promise<"OK" | "INCOMPLETE"> {
  if (storage.provider !== "local") {
    return "INCOMPLETE";
  }
  if (contentType && contentType.toLowerCase() !== intent.mime.toLowerCase()) {
    return "INCOMPLETE";
  }

  let received = 0;
  const guarded = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > intent.sizeBytes) {
          controller.error(new Error("UPLOAD_TOO_LARGE"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    await storage.put(intent.tempKey, guarded, {
      sizeBytes: intent.sizeBytes,
      contentType: intent.mime,
    });
    return "OK";
  } catch (error) {
    await storage.delete(intent.tempKey).catch(() => undefined);
    console.warn(
      `Local upload write failed for ${intent.tempKey}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (error instanceof Error) {
      return "INCOMPLETE";
    }
    throw error;
  }
}

export type CompleteUploadResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "INCOMPLETE" }
  | { kind: "INVALID_CONTENT"; message: string }
  | { kind: "OK"; job: Awaited<ReturnType<typeof createJob>> };

export async function completeUpload(
  uploadId: string,
  userId: string,
): Promise<CompleteUploadResult> {
  const lookup = await getUploadIntent(uploadId, userId);
  if (lookup.kind !== "OK") {
    return lookup;
  }
  const { intent } = lookup;
  const object = await storage.head(intent.tempKey);
  if (!object || object.sizeBytes !== intent.sizeBytes) {
    return { kind: "INCOMPLETE" };
  }
  if (object.contentType && object.contentType.toLowerCase() !== intent.mime.toLowerCase()) {
    return { kind: "INCOMPLETE" };
  }
  if (/^(png|jpe?g|webp|pdf|mp4|mov|webm|mkv)$/.test(intent.sourceExt)) {
    const bytes = /^(mp4|mov|webm|mkv)$/.test(intent.sourceExt)
      ? await readStoredPrefix(intent.tempKey, 32)
      : await storage.get(intent.tempKey);
    if (!bytes) {
      return { kind: "INCOMPLETE" };
    }
    const content = await validateStoredMedia(bytes, intent.sourceExt);
    if (!content.ok) {
      await discardIntent(intent.id, intent.tempKey);
      return { kind: "INVALID_CONTENT", message: content.message };
    }
  }

  const job = await createJob({
    userId,
    displayName: intent.filename,
    detailLevel: intent.detailLevel,
    sourceExt: intent.sourceExt,
    sourceSize: intent.sizeBytes,
    sourceMime: intent.mime,
    tempKey: intent.tempKey,
    etag: object.etag ?? undefined,
  });
  await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
  return { kind: "OK", job };
}

export type CompleteUploadBatchResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "INCOMPLETE" }
  | { kind: "INVALID_CONTENT"; message: string }
  | { kind: "OK"; job: Awaited<ReturnType<typeof createJobSources>> };

/**
 * Commit several independently uploaded images as one ordered image-set job.
 * Each image keeps its own temporary intent until every object has passed
 * content validation, so a failed set never creates a partial job.
 */
export async function completeUploadBatch(
  uploadIds: string[],
  userId: string,
  detailLevel: DetailLevel,
): Promise<CompleteUploadBatchResult> {
  if (new Set(uploadIds).size !== uploadIds.length) {
    return { kind: "INCOMPLETE" };
  }
  const rows = await prisma.uploadIntent.findMany({
    where: { id: { in: uploadIds } },
  });
  if (rows.length !== uploadIds.length) {
    return { kind: "NOT_FOUND" };
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = uploadIds.map((id) => byId.get(id)!);
  const now = Date.now();
  if (ordered.some((intent) => intent.userId !== userId)) {
    return { kind: "FORBIDDEN" };
  }
  if (ordered.some((intent) => intent.expiresAt.getTime() <= now)) {
    return { kind: "EXPIRED" };
  }
  if (ordered.some((intent) => !intent.sourceExt.match(/^(png|jpe?g|webp)$/))) {
    return {
      kind: "INVALID_CONTENT",
      message: "Image-set jobs accept PNG, JPG, JPEG, or WebP images only",
    };
  }

  const validated: CreateJobSource[] = [];
  for (const intent of ordered) {
    const object = await storage.head(intent.tempKey);
    if (!object || object.sizeBytes !== intent.sizeBytes) {
      return { kind: "INCOMPLETE" };
    }
    if (
      object.contentType &&
      object.contentType.toLowerCase() !== intent.mime.toLowerCase()
    ) {
      return { kind: "INCOMPLETE" };
    }
    const bytes = await storage.get(intent.tempKey);
    if (!bytes) {
      return { kind: "INCOMPLETE" };
    }
    const content = await validateStoredMedia(bytes, intent.sourceExt);
    if (!content.ok) {
      await discardIntents(ordered);
      return { kind: "INVALID_CONTENT", message: content.message };
    }
    validated.push({
      filename: intent.filename,
      extension: intent.sourceExt,
      sizeBytes: intent.sizeBytes,
      mime: intent.mime,
      tempKey: intent.tempKey,
      etag: object.etag ?? undefined,
    });
  }

  const firstName = ordered[0].filename;
  const displayName =
    ordered.length === 1
      ? firstName
      : `${ordered.length} images — ${firstName}`;
  const job = await createJobSources({
    userId,
    displayName: sanitizeDisplayName(displayName),
    detailLevel,
    sources: validated,
  });
  await prisma.uploadIntent.deleteMany({ where: { id: { in: uploadIds } } });
  return { kind: "OK", job };
}

export type CancelUploadResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

/**
 * Abort an upload intent and remove its temporary object. Expired intents are
 * still cancellable by their owner so the client can clean up a late transfer.
 */
export async function cancelUpload(
  uploadId: string,
  userId: string,
): Promise<CancelUploadResult> {
  const intent = await prisma.uploadIntent.findUnique({ where: { id: uploadId } });
  if (!intent) {
    return { kind: "NOT_FOUND" };
  }
  if (intent.userId !== userId) {
    return { kind: "FORBIDDEN" };
  }

  await storage.delete(intent.tempKey);
  await prisma.uploadIntent.delete({ where: { id: intent.id } });
  return { kind: "OK" };
}

async function discardIntent(id: string, tempKey: string): Promise<void> {
  await storage.delete(tempKey);
  await prisma.uploadIntent.deleteMany({ where: { id } });
}

async function discardIntents(
  intents: Array<{ id: string; tempKey: string }>,
): Promise<void> {
  await storage.deleteMany(intents.map((intent) => intent.tempKey));
  await prisma.uploadIntent.deleteMany({
    where: { id: { in: intents.map((intent) => intent.id) } },
  });
}

async function readStoredPrefix(key: string, limit: number): Promise<Uint8Array | null> {
  const body = await storage.stream(key);
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, Math.max(0, limit - total));
      chunks.push(take);
      total += take.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
