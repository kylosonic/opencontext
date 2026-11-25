import { prisma } from "@/server/db/prisma";
import { canManageJob } from "@/server/workspaces";
import { jobToDetail } from "./serialize";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_RENAME_LENGTH = 200;

export function normalizeJobDisplayName(raw: string): string | null {
  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > MAX_RENAME_LENGTH) {
    return null;
  }
  return cleaned;
}

export type RenameJobResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID" }
  | { kind: "OK"; job: ReturnType<typeof jobToDetail> };

/** Rename a job's displayName cleanly (owner or team OWNER/ADMIN). */
export async function renameJob(
  jobId: string,
  userId: string,
  rawName: string,
): Promise<RenameJobResult> {
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      media: { where: { kind: "SOURCE" } },
      workspace: { select: { name: true } },
    },
  });
  if (!existing) return { kind: "NOT_FOUND" };
  if (!(await canManageJob(existing, userId, "jobs:edit"))) {
    return { kind: "FORBIDDEN" };
  }
  const normalized = normalizeJobDisplayName(rawName);
  if (!normalized) return { kind: "INVALID" };

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: { displayName: normalized },
  });
  return {
    kind: "OK",
    job: jobToDetail(
      updated,
      existing.media,
      true,
      existing.workspace?.name ?? null,
    ),
  };
}
