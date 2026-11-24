import { randomUUID } from "node:crypto";
import {
  UPLOAD_LIMITS,
  type DetailLevel,
  type ErrorCode,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { sanitizeDisplayName, validateUpload } from "@/server/validation/upload";
import { canAccessWorkspace } from "@/server/workspaces";

export interface CreateUploadIntentInput {
  userId: string;
  filename: string;
  sizeBytes: number;
  mime?: string;
  detailLevel: DetailLevel;
  workspaceId?: string;
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

/** Create a short-lived upload intent and presigned S3 or local upload URL. */
export async function createUploadIntent(
  input: CreateUploadIntentInput,
): Promise<CreateUploadIntentResult> {
  const validation = validateUpload(input.filename, input.sizeBytes, input.mime);
  if (!validation.ok) {
    return { kind: "INVALID", code: validation.code, message: validation.message };
  }
  if (
    input.workspaceId &&
    !(await canAccessWorkspace(input.workspaceId, input.userId))
  ) {
    return {
      kind: "INVALID",
      code: "FORBIDDEN",
      message: "You don't have access to that team",
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_LIMITS.intentTtlSec * 1000);
  const expired = await prisma.uploadIntent.findMany({
    where: {
      userId: input.userId,
      expiresAt: { lte: now },
      claimedAt: null,
    },
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
      workspaceId: input.workspaceId ?? null,
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
  | { kind: "IN_PROGRESS" }
  | {
      kind: "OK";
      intent: NonNullable<Awaited<ReturnType<typeof prisma.uploadIntent.findUnique>>>;
    };

/** Fetch an unclaimed, unexpired upload intent owned by `userId`. */
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
  if (intent.claimedAt) {
    return { kind: "IN_PROGRESS" };
  }
  return { kind: "OK", intent };
}

/** Stream a direct local-disk upload body with a strict byte ceiling. */
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

export type CancelUploadResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "IN_PROGRESS" }
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
  if (intent.claimedAt) {
    return { kind: "IN_PROGRESS" };
  }

  await storage.deleteMany([intent.tempKey]);
  await prisma.uploadIntent.deleteMany({ where: { id: intent.id } });
  return { kind: "OK" };
}
