import type { Job, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

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
