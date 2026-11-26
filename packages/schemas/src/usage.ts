import { z } from "zod";
import { SourceKindSchema } from "./job.js";

export const USAGE_INVOICE_MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export const UsageInvoiceMonthSchema = z
  .string()
  .regex(USAGE_INVOICE_MONTH_RE, "Expected an invoice month in YYYY-MM format");

export const UsageInvoicePeriodSchema = z.object({
  month: UsageInvoiceMonthSchema,
  start: z.string().datetime(),
  endExclusive: z.string().datetime(),
});

export const UsageInvoiceScopeSchema = z.object({
  type: z.enum(["personal", "team"]),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
});

export const UsageInvoiceLineSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().nullable(),
  description: z.string().min(1).max(300),
  kind: z.string().min(1).max(64),
  sourceKind: SourceKindSchema,
  detailLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(64),
  unitCostMicros: z.number().int().nonnegative(),
  totalCostMicros: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
});

export const UsageInvoiceTotalsSchema = z.object({
  lineItems: z.number().int().nonnegative(),
  mediaSeconds: z.number().nonnegative(),
  stillJobs: z.number().nonnegative(),
  costMicros: z.number().int().nonnegative(),
});

export const UsageInvoiceSchema = z
  .object({
    invoiceNumber: z.string().min(1).max(64),
    status: z.literal("DRAFT"),
    currency: z.literal("USD"),
    period: UsageInvoicePeriodSchema,
    scope: UsageInvoiceScopeSchema,
    totals: UsageInvoiceTotalsSchema,
    lineItems: z.array(UsageInvoiceLineSchema).max(10_000),
    notes: z.array(z.string().min(1).max(300)).max(8),
    generatedAt: z.string().datetime(),
  })
  .superRefine((invoice, context) => {
    if (invoice.totals.lineItems !== invoice.lineItems.length) {
      context.addIssue({
        code: "custom",
        path: ["totals", "lineItems"],
        message: "totals.lineItems must match the number of line items",
      });
    }
    const costMicros = invoice.lineItems.reduce(
      (total, line) => total + line.totalCostMicros,
      0,
    );
    if (invoice.totals.costMicros !== costMicros) {
      context.addIssue({
        code: "custom",
        path: ["totals", "costMicros"],
        message: "totals.costMicros must match the line-item total",
      });
    }
    if (
      invoice.scope.type === "personal" &&
      (invoice.scope.workspaceId !== null ||
        invoice.scope.workspaceName !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Personal invoices cannot include a workspace",
      });
    }
    if (
      invoice.scope.type === "team" &&
      (!invoice.scope.workspaceId || !invoice.scope.workspaceName)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Team invoices require a workspace id and name",
      });
    }
  });

export type UsageInvoiceMonth = z.infer<typeof UsageInvoiceMonthSchema>;
export type UsageInvoicePeriod = z.infer<typeof UsageInvoicePeriodSchema>;
export type UsageInvoiceScope = z.infer<typeof UsageInvoiceScopeSchema>;
export type UsageInvoiceLine = z.infer<typeof UsageInvoiceLineSchema>;
export type UsageInvoiceTotals = z.infer<typeof UsageInvoiceTotalsSchema>;
export type UsageInvoice = z.infer<typeof UsageInvoiceSchema>;
