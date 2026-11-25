import type { Job, Prisma } from "@prisma/client";
import { sourceKindForExtension } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { canAccessWorkspace } from "@/server/workspaces";

function nonNegativeInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface AnalysisPrice {
  quantity: number;
  unit: "media-second" | "job";
  unitCostMicros: number;
  totalCostMicros: number;
}

/** Provider-neutral resale price. Zero by default until operators opt in. */
export function analysisPrice(job: Pick<Job, "durationSec" | "sourceExt">): AnalysisPrice {
  if ((job.durationSec ?? 0) > 0) {
    const quantity = Math.max(0.001, job.durationSec ?? 0);
    const unitCostMicros = nonNegativeInt("BILLING_ANALYSIS_MICROS_PER_SECOND", 0);
    return {
      quantity,
      unit: "media-second",
      unitCostMicros,
      totalCostMicros: Math.round(quantity * unitCostMicros),
    };
  }
  const unitCostMicros = nonNegativeInt("BILLING_STILL_JOB_MICROS", 0);
  return {
    quantity: 1,
    unit: "job",
    unitCostMicros,
    totalCostMicros: unitCostMicros,
  };
}

function eventKey(jobId: string): string {
  return `analysis:${jobId}`;
}

/** Idempotently write the billable analysis event for a terminal job. */
export async function recordAnalysisUsage(
  jobId: string,
  finalStatus: "COMPLETED" | "PARTIAL",
): Promise<boolean> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return false;
  const price = analysisPrice(job);
  const metadata = {
    finalStatus,
    sourceExt: job.sourceExt,
    detailLevel: job.detailLevel,
  } satisfies Prisma.InputJsonObject;
  await prisma.usageRecord.upsert({
    where: { eventKey: eventKey(job.id) },
    create: {
      eventKey: eventKey(job.id),
      userId: job.userId,
      workspaceId: job.workspaceId,
      jobId: job.id,
      kind: "ANALYSIS",
      quantity: price.quantity,
      unit: price.unit,
      unitCostMicros: price.unitCostMicros,
      totalCostMicros: price.totalCostMicros,
      provider: "opencontext",
      model: "standard-analysis",
      metadata,
    },
    update: {
      workspaceId: job.workspaceId,
      quantity: price.quantity,
      unit: price.unit,
      unitCostMicros: price.unitCostMicros,
      totalCostMicros: price.totalCostMicros,
      metadata,
    },
  });
  return true;
}

/** Recover terminal jobs whose best-effort usage write was interrupted. */
export async function reconcileAnalysisUsage(limit = 100): Promise<number> {
  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ["COMPLETED", "PARTIAL"] },
      usageRecords: { none: { kind: "ANALYSIS" } },
    },
    select: { id: true, status: true },
    orderBy: { completedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 1_000),
  });
  let written = 0;
  for (const job of jobs) {
    if (await recordAnalysisUsage(job.id, job.status as "COMPLETED" | "PARTIAL")) {
      written += 1;
    }
  }
  return written;
}

export async function usageForUser(userId: string, since?: Date) {
  return prisma.usageRecord.findMany({
    where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export interface UsageSummaryEntry {
  id: string;
  jobId: string | null;
  jobDisplayName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  kind: string;
  quantity: number;
  unit: string;
  totalCostMicros: number;
  detailLevel: string | null;
  sourceKind: "video" | "audio" | "image" | "pdf" | "unknown";
  createdAt: string;
}

export interface UsageDashboardSummary {
  days: number;
  since: string;
  workspaceId: string | null;
  totalRecords: number;
  totalCostMicros: number;
  totalMediaSeconds: number;
  totalStillJobs: number;
  byDetailLevel: Record<"LOW" | "MEDIUM" | "HIGH", number>;
  bySourceKind: Record<"video" | "audio" | "image" | "pdf" | "unknown", number>;
  recent: UsageSummaryEntry[];
}

function clampDays(raw?: number): number {
  if (!raw || !Number.isSafeInteger(raw)) return 30;
  return Math.min(Math.max(raw, 1), 365);
}

/** Aggregate usage metrics for a personal view or accessible team workspace. */
export async function usageSummaryForUser(
  userId: string,
  options: { workspaceId?: string; days?: number } = {},
): Promise<UsageDashboardSummary | null> {
  const days = clampDays(options.days);
  const sinceDate = new Date(Date.now() - days * 86_400_000);
  const workspaceId = options.workspaceId?.trim() || undefined;

  if (workspaceId && !(await canAccessWorkspace(workspaceId, userId))) {
    return null;
  }

  const where: Prisma.UsageRecordWhereInput = workspaceId
    ? { workspaceId, createdAt: { gte: sinceDate } }
    : { userId, createdAt: { gte: sinceDate } };

  const rows = await prisma.usageRecord.findMany({
    where,
    include: {
      job: { select: { id: true, displayName: true } },
      workspace: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  const byDetailLevel = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const bySourceKind = {
    video: 0,
    audio: 0,
    image: 0,
    pdf: 0,
    unknown: 0,
  };
  let totalCostMicros = 0;
  let totalMediaSeconds = 0;
  let totalStillJobs = 0;

  const recent: UsageSummaryEntry[] = [];
  for (const row of rows) {
    totalCostMicros += row.totalCostMicros;
    if (row.unit === "media-second") {
      totalMediaSeconds += row.quantity;
    } else if (row.unit === "job") {
      totalStillJobs += row.quantity;
    }

    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const detailLevel =
      meta.detailLevel === "LOW" ||
      meta.detailLevel === "MEDIUM" ||
      meta.detailLevel === "HIGH"
        ? meta.detailLevel
        : null;
    if (detailLevel) byDetailLevel[detailLevel] += 1;

    const rawExt = typeof meta.sourceExt === "string" ? meta.sourceExt : "";
    const kind = rawExt ? sourceKindForExtension(rawExt) : "unknown";
    bySourceKind[kind] += 1;

    if (recent.length < 50) {
      recent.push({
        id: row.id,
        jobId: row.jobId,
        jobDisplayName: row.job?.displayName ?? null,
        workspaceId: row.workspaceId,
        workspaceName: row.workspace?.name ?? null,
        kind: row.kind,
        quantity: row.quantity,
        unit: row.unit,
        totalCostMicros: row.totalCostMicros,
        detailLevel,
        sourceKind: kind,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  return {
    days,
    since: sinceDate.toISOString(),
    workspaceId: workspaceId ?? null,
    totalRecords: rows.length,
    totalCostMicros,
    totalMediaSeconds: Math.round(totalMediaSeconds * 100) / 100,
    totalStillJobs,
    byDetailLevel,
    bySourceKind,
    recent,
  };
}
