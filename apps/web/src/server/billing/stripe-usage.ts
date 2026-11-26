import Stripe from "stripe";
import type { UsageRecord } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  createStripeClient,
  resolveStripeBillingConfig,
  type StripeBillingConfigResult,
} from "@/server/billing/stripe";

const BILLABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const MAX_SYNC_ATTEMPTS = 10;
const MAX_RETRY_AGE_DAYS = 30;

export type StripeUsageSyncResult =
  | "SYNCED"
  | "DISABLED"
  | "SKIPPED_ZERO"
  | "PENDING"
  | "ALREADY_SYNCED"
  | "FAILED";

function scopeKeyFor(
  usage: Pick<UsageRecord, "userId" | "workspaceId">,
): string {
  return usage.workspaceId
    ? `workspace:${usage.workspaceId}`
    : `user:${usage.userId}`;
}

function amountCentsFor(totalCostMicros: number): number {
  if (totalCostMicros <= 0) return 0;
  // Usage is stored in micro-USD; Stripe invoice items use integer cents.
  // Round up so a positive amount is never silently billed as zero.
  return Math.ceil(totalCostMicros / 10_000);
}

function safeStripeError(error: unknown): string {
  return error instanceof Stripe.errors.StripeError
    ? error.type
    : "provider_error";
}

async function getOrCreateUsageItem(usageRecordId: string) {
  const existing = await prisma.stripeUsageItem.findUnique({
    where: { usageRecordId },
  });
  if (existing) return existing;
  try {
    return await prisma.stripeUsageItem.create({ data: { usageRecordId } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return prisma.stripeUsageItem.findUniqueOrThrow({
        where: { usageRecordId },
      });
    }
    throw error;
  }
}

/**
 * Push one positive analysis usage event to Stripe as an idempotent invoice
 * item. Completion never depends on this best-effort call.
 */
export async function syncUsageRecordToStripe(
  usageRecordId: string,
  options: {
    config?: StripeBillingConfigResult;
    stripe?: Stripe;
  } = {},
): Promise<StripeUsageSyncResult> {
  const configResult = options.config ?? resolveStripeBillingConfig();
  if (configResult.kind !== "OK" || !configResult.config.usageBillingEnabled) {
    return "DISABLED";
  }
  const usage = await prisma.usageRecord.findUnique({
    where: { id: usageRecordId },
  });
  if (!usage) return "SKIPPED_ZERO";
  const amountCents = amountCentsFor(usage.totalCostMicros);
  const existing = await getOrCreateUsageItem(usage.id);
  if (existing.status === "SYNCED") return "ALREADY_SYNCED";
  if (amountCents === 0) {
    await prisma.stripeUsageItem.update({
      where: { id: existing.id },
      data: { status: "SKIPPED_ZERO", amountCents: 0, lastError: null },
    });
    return "SKIPPED_ZERO";
  }

  const account = await prisma.billingAccount.findUnique({
    where: { scopeKey: scopeKeyFor(usage) },
  });
  if (
    !account?.stripeSubscriptionId ||
    account.stripeMode !== configResult.config.mode ||
    !account.subscriptionStatus ||
    !BILLABLE_STATUSES.has(account.subscriptionStatus)
  ) {
    await prisma.stripeUsageItem.update({
      where: { id: existing.id },
      data: {
        amountCents,
        status: "PENDING",
        lastError: "No billable subscription for this scope",
      },
    });
    return "PENDING";
  }

  await prisma.stripeUsageItem.update({
    where: { id: existing.id },
    data: {
      billingAccountId: account.id,
      amountCents,
      status: "PENDING",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  try {
    const stripe = options.stripe ?? createStripeClient(configResult.config);
    const invoiceItem = await stripe.invoiceItems.create(
      {
        customer: account.stripeCustomerId,
        subscription: account.stripeSubscriptionId,
        amount: amountCents,
        currency: "usd",
        description: "OpenContext analysis usage",
        metadata: {
          usage_record_id: usage.id,
          usage_event_key: usage.eventKey,
          ...(usage.jobId ? { job_id: usage.jobId } : {}),
          ...(usage.workspaceId ? { workspace_id: usage.workspaceId } : {}),
          unit: usage.unit,
        },
      },
      {
        idempotencyKey: `opencontext-usage-${usage.eventKey}`,
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    await prisma.stripeUsageItem.update({
      where: { id: existing.id },
      data: {
        stripeInvoiceItemId: invoiceItem.id,
        status: "SYNCED",
        lastError: null,
      },
    });
    return "SYNCED";
  } catch (error) {
    await prisma.stripeUsageItem.update({
      where: { id: existing.id },
      data: { status: "FAILED", lastError: safeStripeError(error) },
    });
    console.error(
      "Stripe usage billing failed; reconciliation will retry:",
      safeStripeError(error),
    );
    return "FAILED";
  }
}

export interface StripeUsageReconcileResult {
  enabled: boolean;
  attempted: number;
  synced: number;
  pending: number;
  failed: number;
}

/** Retry unsynced usage and pick up ledger rows created before the migration. */
export async function reconcileStripeUsage(
  limit = 100,
  options: {
    config?: StripeBillingConfigResult;
    stripe?: Stripe;
  } = {},
): Promise<StripeUsageReconcileResult> {
  const configResult = options.config ?? resolveStripeBillingConfig();
  if (configResult.kind !== "OK" || !configResult.config.usageBillingEnabled) {
    return { enabled: false, attempted: 0, synced: 0, pending: 0, failed: 0 };
  }

  const bounded = Math.min(Math.max(limit, 1), 1_000);
  const retryCutoff = new Date(Date.now() - MAX_RETRY_AGE_DAYS * 86_400_000);
  const [unlinked, retryable] = await Promise.all([
    prisma.usageRecord.findMany({
      where: {
        totalCostMicros: { gt: 0 },
        createdAt: { gte: retryCutoff },
        stripeUsageItem: null,
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: bounded,
    }),
    prisma.stripeUsageItem.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        attempts: { lt: MAX_SYNC_ATTEMPTS },
        createdAt: { gte: retryCutoff },
      },
      select: { usageRecordId: true },
      orderBy: { createdAt: "asc" },
      take: bounded,
    }),
  ]);

  const ids = [
    ...new Set([
      ...unlinked.map((row) => row.id),
      ...retryable.map((row) => row.usageRecordId),
    ]),
  ].slice(0, bounded);
  const result: StripeUsageReconcileResult = {
    enabled: true,
    attempted: ids.length,
    synced: 0,
    pending: 0,
    failed: 0,
  };
  for (const id of ids) {
    const outcome = await syncUsageRecordToStripe(id, options);
    if (outcome === "SYNCED") result.synced += 1;
    else if (outcome === "FAILED") result.failed += 1;
    else if (outcome === "PENDING") result.pending += 1;
  }
  return result;
}
