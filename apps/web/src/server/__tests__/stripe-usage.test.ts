import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  reconcileStripeUsage,
  syncUsageRecordToStripe,
} from "@/server/billing/stripe-usage";
import type { StripeBillingConfigResult } from "@/server/billing/stripe";
import { createUser, resetDatabase } from "./helpers";

const TEST_SECRET = "sk_test_opencontext_usage";
const TEST_CONFIG: StripeBillingConfigResult = {
  kind: "OK",
  config: {
    secretKey: TEST_SECRET,
    webhookSecret: "whsec_opencontext_usage",
    priceId: "price_opencontext_usage",
    baseUrl: "http://localhost:3000",
    mode: "test",
    usageBillingEnabled: true,
  },
};

async function createUsage(
  userId: string,
  totalCostMicros: number,
  suffix: string,
) {
  return prisma.usageRecord.create({
    data: {
      eventKey: `analysis:${suffix}`,
      userId,
      jobId: null,
      kind: "ANALYSIS",
      quantity: 12,
      unit: "media-second",
      unitCostMicros: totalCostMicros === 0 ? 0 : 1,
      totalCostMicros,
      provider: "opencontext",
      model: "standard-analysis",
    },
  });
}

async function createBillableAccount(userId: string, suffix = "active") {
  return prisma.billingAccount.create({
    data: {
      scopeKey: `user:${userId}`,
      userId,
      stripeCustomerId: `cus_${suffix}`,
      stripeSubscriptionId: `sub_${suffix}`,
      subscriptionStatus: "active",
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Stripe usage billing", () => {
  it("posts one rounded invoice item and remains idempotent", async () => {
    const user = await createUser();
    const usage = await createUsage(user.id, 10_001, "positive");
    await createBillableAccount(user.id);
    const stripe = new Stripe(TEST_SECRET);
    const create = vi
      .spyOn(stripe.invoiceItems, "create")
      .mockResolvedValue({ id: "ii_opencontext" } as never);

    expect(
      await syncUsageRecordToStripe(usage.id, { config: TEST_CONFIG, stripe }),
    ).toBe("SYNCED");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_active",
        subscription: "sub_active",
        amount: 2,
        currency: "usd",
        metadata: expect.objectContaining({
          usage_record_id: usage.id,
          usage_event_key: usage.eventKey,
        }),
      }),
      {
        idempotencyKey: `opencontext-usage-${usage.eventKey}`,
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({
      stripeInvoiceItemId: "ii_opencontext",
      amountCents: 2,
      status: "SYNCED",
      attempts: 1,
    });

    expect(
      await syncUsageRecordToStripe(usage.id, { config: TEST_CONFIG, stripe }),
    ).toBe("ALREADY_SYNCED");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("records a zero-price event without calling Stripe", async () => {
    const user = await createUser();
    const usage = await createUsage(user.id, 0, "zero");
    const stripe = new Stripe(TEST_SECRET);
    const create = vi.spyOn(stripe.invoiceItems, "create");

    expect(
      await syncUsageRecordToStripe(usage.id, { config: TEST_CONFIG, stripe }),
    ).toBe("SKIPPED_ZERO");
    expect(create).not.toHaveBeenCalled();
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({ amountCents: 0, status: "SKIPPED_ZERO" });
  });

  it("keeps usage pending when the scope has no billable subscription", async () => {
    const user = await createUser();
    const usage = await createUsage(user.id, 25_000, "unsubscribed");
    await prisma.billingAccount.create({
      data: {
        scopeKey: `user:${user.id}`,
        userId: user.id,
        stripeCustomerId: "cus_without_subscription",
      },
    });
    const stripe = new Stripe(TEST_SECRET);
    const create = vi.spyOn(stripe.invoiceItems, "create");

    expect(
      await syncUsageRecordToStripe(usage.id, { config: TEST_CONFIG, stripe }),
    ).toBe("PENDING");
    expect(create).not.toHaveBeenCalled();
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({
      amountCents: 3,
      status: "PENDING",
      lastError: "No billable subscription for this scope",
    });
  });

  it("does not submit test-mode subscriptions with a live billing key", async () => {
    const user = await createUser();
    const usage = await createUsage(user.id, 25_000, "wrong-mode");
    await createBillableAccount(user.id, "wrong-mode");
    const stripe = new Stripe("sk_live_opencontext_usage");

    expect(
      await syncUsageRecordToStripe(usage.id, {
        config: {
          kind: "OK",
          config: { ...TEST_CONFIG.config, mode: "live" },
        },
        stripe,
      }),
    ).toBe("PENDING");
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({
      amountCents: 3,
      status: "PENDING",
      lastError: "No billable subscription for this scope",
    });
  });

  it("records provider failures without throwing and lets reconciliation retry", async () => {
    const user = await createUser();
    const usage = await createUsage(user.id, 50_000, "retry");
    await createBillableAccount(user.id, "retry");
    const stripe = new Stripe(TEST_SECRET);
    const create = vi
      .spyOn(stripe.invoiceItems, "create")
      .mockRejectedValueOnce(new Error("simulated Stripe outage"))
      .mockResolvedValueOnce({ id: "ii_after_retry" } as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      await syncUsageRecordToStripe(usage.id, { config: TEST_CONFIG, stripe }),
    ).toBe("FAILED");
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastError: "provider_error",
    });

    expect(
      await reconcileStripeUsage(100, { config: TEST_CONFIG, stripe }),
    ).toEqual({
      enabled: true,
      attempted: 1,
      synced: 1,
      pending: 0,
      failed: 0,
    });
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usage.id },
      }),
    ).toMatchObject({
      stripeInvoiceItemId: "ii_after_retry",
      status: "SYNCED",
      attempts: 2,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reconciles unlinked and failed usage records and does not replay synced rows", async () => {
    const user = await createUser();
    const account = await createBillableAccount(user.id, "reconcile");
    const unlinked = await createUsage(user.id, 10_000, "unlinked");
    const failed = await createUsage(user.id, 20_000, "failed");
    await prisma.stripeUsageItem.create({
      data: {
        usageRecordId: failed.id,
        billingAccountId: account.id,
        amountCents: 2,
        status: "FAILED",
        attempts: 1,
        lastError: "provider_error",
      },
    });
    const stripe = new Stripe(TEST_SECRET);
    let invoiceItemNumber = 0;
    const create = vi
      .spyOn(stripe.invoiceItems, "create")
      .mockImplementation(
        async () => ({ id: `ii_reconcile_${++invoiceItemNumber}` }) as never,
      );

    expect(
      await reconcileStripeUsage(100, { config: TEST_CONFIG, stripe }),
    ).toEqual({
      enabled: true,
      attempted: 2,
      synced: 2,
      pending: 0,
      failed: 0,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(
      await prisma.stripeUsageItem.count({ where: { status: "SYNCED" } }),
    ).toBe(2);

    expect(
      await reconcileStripeUsage(100, { config: TEST_CONFIG, stripe }),
    ).toEqual({
      enabled: true,
      attempted: 0,
      synced: 0,
      pending: 0,
      failed: 0,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(unlinked.id).not.toBe(failed.id);
  });
});
