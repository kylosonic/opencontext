import { randomUUID } from "node:crypto";
import {
  UPLOAD_LIMITS,
  type DetailLevel,
  type ErrorCode,
} from "@opencontext/schemas";
import { prisma } from "@/server/db/prisma";
import { createJob } from "@/server/jobs";
import { storage } from "@/server/storage";
import { sanitizeDisplayName, validateUpload } from "@/server/validation/upload";

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
  await prisma.uploadIntent.deleteMany({
    where: { userId: input.userId, expiresAt: { lte: now } },
  });

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

  const job = await createJob({
    userId,
    displayName: intent.filename,
    detailLevel: intent.detailLevel,
    sourceExt: intent.sourceExt,
    sourceSize: intent.sizeBytes,
    sourceMime: intent.mime,
    tempKey: intent.tempKey,
  });
  await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
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
