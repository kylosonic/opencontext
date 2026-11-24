import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import {
  createJob,
  createJobSources,
  type CreateJobSource,
} from "@/server/jobs";
import { storage } from "@/server/storage";
import { sanitizeDisplayName, validateStoredMedia } from "@/server/validation/upload";
import { canAccessWorkspace } from "@/server/workspaces";
import { getUploadIntent } from "./intents";

class UploadClaimConflict extends Error {}

async function claimUploadIntents(
  uploadIds: string[],
  userId: string,
): Promise<boolean> {
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.uploadIntent.updateMany({
        where: {
          id: { in: uploadIds },
          userId,
          claimedAt: null,
          expiresAt: { gt: now },
        },
        data: { claimedAt: now },
      });
      if (claimed.count !== new Set(uploadIds).size) {
        throw new UploadClaimConflict();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof UploadClaimConflict) return false;
    throw error;
  }
}

async function releaseUploadClaims(uploadIds: string[]): Promise<void> {
  await prisma.uploadIntent.updateMany({
    where: { id: { in: uploadIds }, claimedAt: { not: null } },
    data: { claimedAt: null },
  });
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

export type CompleteUploadResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "IN_PROGRESS" }
  | { kind: "INCOMPLETE" }
  | { kind: "INVALID_CONTENT"; message: string }
  | { kind: "OK"; job: Awaited<ReturnType<typeof createJob>> };

/** Verify the uploaded object for an intent and create its queued job. */
export async function completeUpload(
  uploadId: string,
  userId: string,
): Promise<CompleteUploadResult> {
  const lookup = await getUploadIntent(uploadId, userId);
  if (lookup.kind !== "OK") {
    return lookup;
  }
  const { intent } = lookup;
  if (!(await claimUploadIntents([intent.id], userId))) {
    return { kind: "IN_PROGRESS" };
  }
  let object: Awaited<ReturnType<typeof storage.head>>;
  try {
    object = await storage.head(intent.tempKey);
  } catch (error) {
    await releaseUploadClaims([intent.id]).catch(() => undefined);
    throw error;
  }
  if (!object || object.sizeBytes !== intent.sizeBytes) {
    await releaseUploadClaims([intent.id]);
    return { kind: "INCOMPLETE" };
  }
  if (object.contentType && object.contentType.toLowerCase() !== intent.mime.toLowerCase()) {
    await releaseUploadClaims([intent.id]);
    return { kind: "INCOMPLETE" };
  }
  if (/^(png|jpe?g|webp|pdf|mp4|mov|webm|mkv|mp3|m4a|wav|ogg|aac|flac)$/.test(intent.sourceExt)) {
    let bytes: Uint8Array | null;
    try {
      bytes = /^(mp4|mov|webm|mkv|mp3|m4a|wav|ogg|aac|flac)$/.test(intent.sourceExt)
        ? await readStoredPrefix(intent.tempKey, 64)
        : intent.sourceExt === "pdf"
          ? await readStoredPrefix(intent.tempKey, 5)
          : await storage.get(intent.tempKey);
    } catch (error) {
      await releaseUploadClaims([intent.id]).catch(() => undefined);
      throw error;
    }
    if (!bytes) {
      await releaseUploadClaims([intent.id]);
      return { kind: "INCOMPLETE" };
    }
    const content = await validateStoredMedia(bytes, intent.sourceExt);
    if (!content.ok) {
      await discardIntent(intent.id, intent.tempKey);
      return { kind: "INVALID_CONTENT", message: content.message };
    }
  }

  // Membership may have been revoked after the short-lived intent was
  // created. Re-check immediately before committing the durable job so a
  // removed team member cannot place new work in that workspace.
  let workspaceAllowed = true;
  try {
    workspaceAllowed =
      !intent.workspaceId || (await canAccessWorkspace(intent.workspaceId, userId));
  } catch (error) {
    await releaseUploadClaims([intent.id]).catch(() => undefined);
    throw error;
  }
  if (!workspaceAllowed) {
    await releaseUploadClaims([intent.id]);
    return { kind: "FORBIDDEN" };
  }

  let job: Awaited<ReturnType<typeof createJob>>;
  try {
    job = await createJob({
      userId,
      displayName: intent.filename,
      detailLevel: intent.detailLevel,
      sourceExt: intent.sourceExt,
      sourceSize: intent.sizeBytes,
      sourceMime: intent.mime,
      tempKey: intent.tempKey,
      etag: object.etag ?? undefined,
      workspaceId: intent.workspaceId ?? undefined,
    });
  } catch (error) {
    await releaseUploadClaims([intent.id]).catch(() => undefined);
    throw error;
  }
  await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
  return { kind: "OK", job };
}

export type CompleteUploadBatchResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "EXPIRED" }
  | { kind: "IN_PROGRESS" }
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
  workspaceId?: string,
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
  if (workspaceId && !(await canAccessWorkspace(workspaceId, userId))) {
    return { kind: "FORBIDDEN" };
  }
  if (
    ordered.some((intent) => (intent.workspaceId ?? undefined) !== workspaceId)
  ) {
    return {
      kind: "INVALID_CONTENT",
      message: "All images in a set must belong to the same team",
    };
  }
  if (ordered.some((intent) => !intent.sourceExt.match(/^(png|jpe?g|webp)$/))) {
    return {
      kind: "INVALID_CONTENT",
      message: "Image-set jobs accept PNG, JPG, JPEG, or WebP images only",
    };
  }

  if (!(await claimUploadIntents(uploadIds, userId))) {
    return { kind: "IN_PROGRESS" };
  }

  const validated: CreateJobSource[] = [];
  try {
    for (const intent of ordered) {
      const object = await storage.head(intent.tempKey);
      if (!object || object.sizeBytes !== intent.sizeBytes) {
        await releaseUploadClaims(uploadIds);
        return { kind: "INCOMPLETE" };
      }
      if (
        object.contentType &&
        object.contentType.toLowerCase() !== intent.mime.toLowerCase()
      ) {
        await releaseUploadClaims(uploadIds);
        return { kind: "INCOMPLETE" };
      }
      const bytes = await storage.get(intent.tempKey);
      if (!bytes) {
        await releaseUploadClaims(uploadIds);
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
  } catch (error) {
    await releaseUploadClaims(uploadIds).catch(() => undefined);
    throw error;
  }

  const firstName = ordered[0].filename;
  const displayName =
    ordered.length === 1
      ? firstName
      : `${ordered.length} images — ${firstName}`;
  let workspaceAllowed = true;
  try {
    workspaceAllowed = !workspaceId || (await canAccessWorkspace(workspaceId, userId));
  } catch (error) {
    await releaseUploadClaims(uploadIds).catch(() => undefined);
    throw error;
  }
  if (!workspaceAllowed) {
    await releaseUploadClaims(uploadIds);
    return { kind: "FORBIDDEN" };
  }
  let job: Awaited<ReturnType<typeof createJobSources>>;
  try {
    job = await createJobSources({
      userId,
      displayName: sanitizeDisplayName(displayName),
      detailLevel,
      workspaceId,
      sources: validated,
    });
  } catch (error) {
    await releaseUploadClaims(uploadIds).catch(() => undefined);
    throw error;
  }
  await prisma.uploadIntent.deleteMany({ where: { id: { in: uploadIds } } });
  return { kind: "OK", job };
}
