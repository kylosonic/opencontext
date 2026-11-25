import { createHash, randomBytes } from "node:crypto";
import type { JobShare } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getJob, getOwnedJobRow } from "./getJob";
import { jobToDetail } from "./serialize";

export const SHARE_TTL_DAYS = 30;
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type CreateShareResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "NOT_READY" }
  | { kind: "OK"; share: JobShare; token: string };

/** Rotate a public read-only link for a terminal job. The raw token is returned once. */
export async function createJobShare(
  jobId: string,
  userId: string,
): Promise<CreateShareResult> {
  const access = await getOwnedJobRow(jobId, userId, "jobs:share");
  if (access.kind !== "OK") {
    return access.kind === "NOT_FOUND"
      ? { kind: "NOT_FOUND" }
      : { kind: "FORBIDDEN" };
  }
  if (access.job.status !== "COMPLETED" && access.job.status !== "PARTIAL") {
    return { kind: "NOT_READY" };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashShareToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * 24 * 60 * 60_000);
  const share = await prisma.$transaction(async (tx) => {
    await tx.jobShare.updateMany({
      where: { jobId, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.jobShare.create({
      data: { jobId, tokenHash, createdById: userId, expiresAt },
    });
  });
  return { kind: "OK", share, token };
}

export type RevokeShareResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

/** Revoke every active public link for a job. */
export async function revokeJobShares(
  jobId: string,
  userId: string,
): Promise<RevokeShareResult> {
  const access = await getOwnedJobRow(jobId, userId, "jobs:share");
  if (access.kind !== "OK") {
    return access.kind === "NOT_FOUND"
      ? { kind: "NOT_FOUND" }
      : { kind: "FORBIDDEN" };
  }
  await prisma.jobShare.updateMany({
    where: { jobId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { kind: "OK" };
}

export async function activeJobShare(jobId: string) {
  return prisma.jobShare.findFirst({
    where: { jobId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

/** Owner-visible share state for a job they can access. */
export async function jobShareStatus(
  jobId: string,
  userId: string,
): Promise<
  | { kind: "OK"; share: JobShare | null }
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
> {
  const access = await getJob(jobId, userId);
  if (access.kind !== "OK") {
    return access.kind === "NOT_FOUND"
      ? { kind: "NOT_FOUND" }
      : { kind: "FORBIDDEN" };
  }
  return { kind: "OK", share: await activeJobShare(jobId) };
}

/** Resolve a hashed public token without disclosing whether it ever existed. */
export async function getSharedJob(token: string) {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const share = await prisma.jobShare.findFirst({
    where: {
      tokenHash: hashShareToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { job: { include: { media: { where: { kind: "SOURCE" } } } } },
  });
  if (
    !share ||
    (share.job.status !== "COMPLETED" && share.job.status !== "PARTIAL")
  ) {
    return null;
  }
  return { share, job: jobToDetail(share.job, share.job.media) };
}
