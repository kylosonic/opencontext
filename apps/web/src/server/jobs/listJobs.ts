import type { JobStatus, Prisma } from "@prisma/client";
import type { SourceKind } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { jobToSummary } from "./serialize";

/** Max jobs returned by the list endpoint (blueprint §2: "latest 50"). */
export const LIST_LIMIT = 50;

const ACTIVE_STATUSES: JobStatus[] = [
  "QUEUED",
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
];

const EXTENSIONS_BY_KIND: Record<SourceKind, string[]> = {
  video: ["mp4", "mov", "webm", "mkv"],
  audio: ["mp3", "m4a", "wav", "ogg", "aac", "flac"],
  image: ["png", "jpg", "jpeg", "webp"],
  pdf: ["pdf"],
};

export type JobStatusFilter = "ACTIVE" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface ListJobsFilters {
  q?: string;
  status?: JobStatusFilter;
  workspaceId?: string;
  sourceKind?: SourceKind;
}

/** Jobs owned by the caller or shared through one of their teams. */
export async function listJobs(userId: string, filters: ListJobsFilters = {}) {
  const andClauses: Prisma.JobWhereInput[] = [
    {
      OR: [
        { userId },
        { workspace: { members: { some: { userId } } } },
      ],
    },
  ];

  if (filters.status === "ACTIVE") {
    andClauses.push({ status: { in: ACTIVE_STATUSES } });
  } else if (filters.status) {
    andClauses.push({ status: filters.status });
  }

  if (filters.workspaceId === "personal") {
    andClauses.push({ workspaceId: null });
  } else if (filters.workspaceId) {
    andClauses.push({ workspaceId: filters.workspaceId });
  }

  if (filters.sourceKind) {
    andClauses.push({
      sourceExt: { in: EXTENSIONS_BY_KIND[filters.sourceKind] },
    });
  }

  const normalizedQuery = filters.q?.trim().toLowerCase() ?? "";
  // SQLite does not support Prisma `mode: "insensitive"`, so when a text query
  // is present we inspect up to 250 matching jobs and filter case-insensitively
  // in memory, staying portable across SQLite and PostgreSQL.
  const take = normalizedQuery ? 250 : LIST_LIMIT;

  const rows = await prisma.job.findMany({
    where: { AND: andClauses },
    include: {
      workspace: {
        select: {
          name: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  const matched = normalizedQuery
    ? rows
        .filter((job) =>
          job.displayName.toLowerCase().includes(normalizedQuery),
        )
        .slice(0, LIST_LIMIT)
    : rows;

  return matched.map((job) => {
    const role = job.workspace?.members[0]?.role;
    const canManage =
      job.userId === userId || role === "OWNER" || role === "ADMIN";
    return jobToSummary(job, canManage, job.workspace?.name ?? null);
  });
}
