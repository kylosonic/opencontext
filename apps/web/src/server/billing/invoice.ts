import { createHash } from "node:crypto";
import {
  sourceKindForExtension,
  USAGE_INVOICE_MONTH_RE,
  UsageInvoiceSchema,
  type UsageInvoice,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { hasWorkspacePermission } from "@/server/workspaces";

const MAX_INVOICE_LINES = 10_000;

export type UsageInvoiceResult =
  | { kind: "OK"; invoice: UsageInvoice }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID_MONTH" }
  | { kind: "TOO_LARGE" };

interface MonthBounds {
  month: string;
  start: Date;
  endExclusive: Date;
}

export function invoiceMonthBounds(
  input?: string | null,
  now = new Date(),
): MonthBounds | null {
  const month =
    input === undefined || input === null
      ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
      : input.trim();
  if (!USAGE_INVOICE_MONTH_RE.test(month)) return null;
  const [rawYear, rawMonth] = month.split("-");
  const year = Number(rawYear);
  const monthIndex = Number(rawMonth) - 1;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const endExclusive = new Date(Date.UTC(year, monthIndex + 1, 1));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== monthIndex
  ) {
    return null;
  }
  return { month, start, endExclusive };
}

function invoiceNumberFor(
  userId: string,
  workspaceId: string | undefined,
  month: string,
): string {
  const scope = workspaceId ? `workspace:${workspaceId}` : `user:${userId}`;
  const digest = createHash("sha256")
    .update(`opencontext-invoice:${scope}:${month}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `OC-${month.replace("-", "")}-${digest}`;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Build a provider-neutral monthly draft invoice from the idempotent usage
 * ledger. This function never charges, posts, or mutates billing state.
 */
export async function usageInvoiceForUser(
  userId: string,
  options: { month?: string | null; workspaceId?: string; now?: Date } = {},
): Promise<UsageInvoiceResult> {
  const bounds = invoiceMonthBounds(options.month, options.now);
  if (!bounds) return { kind: "INVALID_MONTH" };

  const workspaceId = options.workspaceId?.trim() || undefined;
  if (
    workspaceId &&
    !(await hasWorkspacePermission(workspaceId, userId, "usage:view"))
  ) {
    return { kind: "FORBIDDEN" };
  }

  const workspace = workspaceId
    ? await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true },
      })
    : null;
  if (workspaceId && !workspace) return { kind: "FORBIDDEN" };

  const rows = await prisma.usageRecord.findMany({
    where: {
      kind: "ANALYSIS",
      createdAt: { gte: bounds.start, lt: bounds.endExclusive },
      ...(workspaceId ? { workspaceId } : { userId, workspaceId: null }),
    },
    include: { job: { select: { displayName: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_INVOICE_LINES + 1,
  });
  if (rows.length > MAX_INVOICE_LINES) return { kind: "TOO_LARGE" };

  let mediaSeconds = 0;
  let stillJobs = 0;
  let costMicros = 0;
  const lineItems = rows.map((row) => {
    const metadata = metadataRecord(row.metadata);
    const sourceExt =
      typeof metadata.sourceExt === "string" ? metadata.sourceExt : "";
    const detailLevel =
      metadata.detailLevel === "LOW" ||
      metadata.detailLevel === "MEDIUM" ||
      metadata.detailLevel === "HIGH"
        ? metadata.detailLevel
        : null;
    if (row.unit === "media-second") mediaSeconds += row.quantity;
    if (row.unit === "job") stillJobs += row.quantity;
    costMicros += row.totalCostMicros;
    return {
      id: row.id,
      jobId: row.jobId,
      description: row.job?.displayName ?? "Deleted analysis job",
      kind: row.kind,
      sourceKind: sourceExt ? sourceKindForExtension(sourceExt) : "unknown",
      detailLevel,
      quantity: row.quantity,
      unit: row.unit,
      unitCostMicros: row.unitCostMicros,
      totalCostMicros: row.totalCostMicros,
      recordedAt: row.createdAt.toISOString(),
    } as const;
  });

  const generatedAt = (options.now ?? new Date()).toISOString();
  const invoice = UsageInvoiceSchema.parse({
    invoiceNumber: invoiceNumberFor(userId, workspaceId, bounds.month),
    status: "DRAFT",
    currency: "USD",
    period: {
      month: bounds.month,
      start: bounds.start.toISOString(),
      endExclusive: bounds.endExclusive.toISOString(),
    },
    scope: workspace
      ? {
          type: "team",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }
      : { type: "personal", workspaceId: null, workspaceName: null },
    totals: {
      lineItems: lineItems.length,
      mediaSeconds: Math.round(mediaSeconds * 100) / 100,
      stillJobs: Math.round(stillJobs * 100) / 100,
      costMicros,
    },
    lineItems,
    notes: [
      "Draft export from the OpenContext usage ledger.",
      "No payment has been collected by this export.",
      "Amounts use configured resale prices in integer micro-USD.",
    ],
    generatedAt,
  });

  return { kind: "OK", invoice };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula execution from user-controlled job names.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function usageInvoiceToCsv(invoice: UsageInvoice): string {
  const rows: unknown[][] = [
    [
      "invoice_number",
      "status",
      "currency",
      "period",
      "scope",
      "scope_name",
      "recorded_at",
      "record_id",
      "job_id",
      "description",
      "kind",
      "source_kind",
      "detail_level",
      "quantity",
      "unit",
      "unit_cost_micros",
      "total_cost_micros",
    ],
  ];
  for (const line of invoice.lineItems) {
    rows.push([
      invoice.invoiceNumber,
      invoice.status,
      invoice.currency,
      invoice.period.month,
      invoice.scope.type,
      invoice.scope.workspaceName ?? "",
      line.recordedAt,
      line.id,
      line.jobId ?? "",
      line.description,
      line.kind,
      line.sourceKind,
      line.detailLevel ?? "",
      line.quantity,
      line.unit,
      line.unitCostMicros,
      line.totalCostMicros,
    ]);
  }
  rows.push([
    invoice.invoiceNumber,
    invoice.status,
    invoice.currency,
    invoice.period.month,
    "TOTAL",
    invoice.scope.workspaceName ?? "",
    invoice.generatedAt,
    "",
    "",
    `${invoice.totals.mediaSeconds} media seconds; ${invoice.totals.stillJobs} still jobs`,
    "",
    "",
    "",
    "",
    "",
    "",
    invoice.totals.costMicros,
  ]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
