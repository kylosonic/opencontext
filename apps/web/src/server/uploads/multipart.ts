import { randomUUID } from "node:crypto";
import {
  UPLOAD_LIMITS,
  type DetailLevel,
  type ErrorCode,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { sanitizeDisplayName, validateUpload } from "@/server/validation/upload";
import { canContributeToWorkspace } from "@/server/workspaces";
import { getUploadIntent } from "./intents";

export const DEFAULT_MULTIPART_CHUNK_BYTES = 5 * 1024 * 1024;
export const MIN_LOCAL_CHUNK_BYTES = 64 * 1024;
export const MIN_S3_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_CHUNK_BYTES = 25 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 1_000;

export interface UploadedPartRecord {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface CreateMultipartUploadInput {
  userId: string;
  filename: string;
  sizeBytes: number;
  mime?: string;
  detailLevel: DetailLevel;
  workspaceId?: string;
  chunkSizeBytes?: number;
}

export type CreateMultipartUploadResult =
  | {
      kind: "OK";
      uploadId: string;
      chunkSizeBytes: number;
      totalParts: number;
      expiresAt: string;
    }
  | {
      kind: "INVALID";
      code: ErrorCode;
      message: string;
    };

export function parseUploadedParts(raw: string | null | undefined): UploadedPartRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: UploadedPartRecord[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        Number.isInteger((item as UploadedPartRecord).partNumber) &&
        typeof (item as UploadedPartRecord).etag === "string" &&
        Number.isInteger((item as UploadedPartRecord).sizeBytes)
      ) {
        entries.push({
          partNumber: (item as UploadedPartRecord).partNumber,
          etag: (item as UploadedPartRecord).etag,
          sizeBytes: (item as UploadedPartRecord).sizeBytes,
        });
      }
    }
    return entries.sort((a, b) => a.partNumber - b.partNumber);
  } catch {
    return [];
  }
}

export function resolveChunkSizeBytes(requested?: number): number {
  const minChunk =
    storage.provider === "s3" ? MIN_S3_CHUNK_BYTES : MIN_LOCAL_CHUNK_BYTES;
  const candidate =
    requested && Number.isSafeInteger(requested)
      ? requested
      : DEFAULT_MULTIPART_CHUNK_BYTES;
  return Math.min(Math.max(candidate, minChunk), MAX_MULTIPART_CHUNK_BYTES);
}

/** Initialize a resumable chunked/multipart upload session for large media files. */
export async function createMultipartUploadIntent(
  input: CreateMultipartUploadInput,
): Promise<CreateMultipartUploadResult> {
  const validation = validateUpload(input.filename, input.sizeBytes, input.mime);
  if (!validation.ok) {
    return { kind: "INVALID", code: validation.code, message: validation.message };
  }
  if (
    input.workspaceId &&
    !(await canContributeToWorkspace(input.workspaceId, input.userId))
  ) {
    return {
      kind: "INVALID",
      code: "FORBIDDEN",
      message: "You don't have permission to upload to that team",
    };
  }

  const chunkSizeBytes = resolveChunkSizeBytes(input.chunkSizeBytes);
  const totalParts = Math.ceil(input.sizeBytes / chunkSizeBytes);
  if (totalParts < 1 || totalParts > MAX_MULTIPART_PARTS) {
    return {
      kind: "INVALID",
      code: "VALIDATION_ERROR",
      message: `Chunk size produces ${totalParts} parts; maximum is ${MAX_MULTIPART_PARTS}`,
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
    select: { id: true, tempKey: true, multipartUploadId: true },
  });
  if (expired.length > 0) {
    for (const stale of expired) {
      if (stale.multipartUploadId) {
        await storage
          .abortMultipartUpload(stale.tempKey, stale.multipartUploadId)
          .catch(() => undefined);
      }
    }
    await storage.deleteMany(expired.map((intent) => intent.tempKey));
    await prisma.uploadIntent.deleteMany({
      where: { id: { in: expired.map((intent) => intent.id) } },
    });
  }

  const tempKey = `incoming/${randomUUID()}.${validation.extension}`;
  const { uploadId: multipartUploadId } = await storage.initMultipartUpload(
    tempKey,
    validation.mime,
  );

  try {
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
        multipartUploadId,
        chunkSizeBytes,
        totalParts,
        uploadedPartsJson: "[]",
      },
    });
    return {
      kind: "OK",
      uploadId: intent.id,
      chunkSizeBytes,
      totalParts,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await storage
      .abortMultipartUpload(tempKey, multipartUploadId)
      .catch(() => undefined);
    throw error;
  }
}

export type UploadStatusResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "IN_PROGRESS" }
  | { kind: "NOT_MULTIPART" }
  | {
      kind: "OK";
      status: {
        uploadId: string;
        filename: string;
        sizeBytes: number;
        chunkSizeBytes: number;
        totalParts: number;
        uploadedParts: UploadedPartRecord[];
        uploadedBytes: number;
        expiresAt: string;
      };
    };

/** Return uploaded parts and remaining state so an interrupted transfer can resume. */
export async function getUploadStatus(
  uploadId: string,
  userId: string,
): Promise<UploadStatusResult> {
  const lookup = await getUploadIntent(uploadId, userId);
  if (lookup.kind !== "OK") return lookup;
  const { intent } = lookup;
  if (!intent.multipartUploadId || !intent.chunkSizeBytes || !intent.totalParts) {
    return { kind: "NOT_MULTIPART" };
  }
  const uploadedParts = parseUploadedParts(intent.uploadedPartsJson);
  const uploadedBytes = uploadedParts.reduce((sum, part) => sum + part.sizeBytes, 0);
  return {
    kind: "OK",
    status: {
      uploadId: intent.id,
      filename: intent.filename,
      sizeBytes: intent.sizeBytes,
      chunkSizeBytes: intent.chunkSizeBytes,
      totalParts: intent.totalParts,
      uploadedParts,
      uploadedBytes,
      expiresAt: intent.expiresAt.toISOString(),
    },
  };
}

export type StoreUploadChunkResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "IN_PROGRESS" }
  | { kind: "INVALID_PART"; message: string }
  | {
      kind: "OK";
      partNumber: number;
      etag: string;
      sizeBytes: number;
      uploadedPartsCount: number;
      totalParts: number;
    };

/** Upload one numbered chunk for a multipart UploadIntent and record its ETag atomically. */
export async function storeUploadChunk(
  uploadId: string,
  userId: string,
  partNumber: number,
  bytes: Uint8Array,
): Promise<StoreUploadChunkResult> {
  const lookup = await getUploadIntent(uploadId, userId);
  if (lookup.kind !== "OK") return lookup;
  const { intent } = lookup;

  if (!intent.multipartUploadId || !intent.chunkSizeBytes || !intent.totalParts) {
    return {
      kind: "INVALID_PART",
      message: "Upload intent is not initialized for chunked uploads",
    };
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > intent.totalParts) {
    return {
      kind: "INVALID_PART",
      message: `Part number must be between 1 and ${intent.totalParts}`,
    };
  }

  const expectedSize =
    partNumber < intent.totalParts
      ? intent.chunkSizeBytes
      : intent.sizeBytes - (intent.totalParts - 1) * intent.chunkSizeBytes;

  if (bytes.byteLength !== expectedSize) {
    return {
      kind: "INVALID_PART",
      message: `Part ${partNumber} must be ${expectedSize} bytes (received ${bytes.byteLength})`,
    };
  }

  const { etag } = await storage.uploadPart(
    intent.tempKey,
    intent.multipartUploadId,
    partNumber,
    bytes,
  );

  const uploadedPartsCount = await prisma.$transaction(async (tx) => {
    const fresh = await tx.uploadIntent.findUnique({
      where: { id: intent.id },
      select: { uploadedPartsJson: true },
    });
    const parts = parseUploadedParts(fresh?.uploadedPartsJson).filter(
      (entry) => entry.partNumber !== partNumber,
    );
    parts.push({ partNumber, etag, sizeBytes: bytes.byteLength });
    parts.sort((a, b) => a.partNumber - b.partNumber);
    await tx.uploadIntent.update({
      where: { id: intent.id },
      data: { uploadedPartsJson: JSON.stringify(parts) },
    });
    return parts.length;
  });

  return {
    kind: "OK",
    partNumber,
    etag,
    sizeBytes: bytes.byteLength,
    uploadedPartsCount,
    totalParts: intent.totalParts,
  };
}
