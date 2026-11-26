import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { POST as checkoutPost } from "@/app/api/billing/checkout/route";
import { GET as statusGet } from "@/app/api/billing/status/route";
import { POST as webhookPost } from "@/app/api/stripe/webhook/route";
import {
  billingOverviewForUser,
  checkoutSessionForUser,
  portalSessionForUser,
  processStripeWebhook,
  resolveStripeBillingConfig,
  type StripeBillingConfigResult,
} from "@/server/billing/stripe";
import { prisma } from "@/server/db/prisma";
import { resetRateLimits } from "@/server/security/rate-limit";
import { createWorkspace } from "@/server/workspaces";
import { createUser, resetDatabase } from "./helpers";

const TEST_SECRET = "sk_test_opencontext_unit";
const TEST_WEBHOOK_SECRET = "whsec_opencontext_unit_secret";
const TEST_PRICE = "price_opencontext_monthly";
const TEST_CONFIG: StripeBillingConfigResult = {
  kind: "OK",
  config: {
    secretKey: TEST_SECRET,
    webhookSecret: TEST_WEBHOOK_SECRET,
    priceId: TEST_PRICE,
    baseUrl: "http://localhost:3000",
    mode: "test",
    usageBillingEnabled: false,
  },
};
const LIVE_CONFIG: StripeBillingConfigResult = {
  kind: "OK",
  config: {
    ...TEST_CONFIG.config,
    secretKey: "sk_live_opencontext_unit",
    mode: "live",
  },
};

function asUser(userId: string | null): void {
  authMock.auth.mockResolvedValue(
    userId ? { user: { id: userId, name: "Billing Tester" } } : null,
  );
}

function subscriptionEvent(options: {
  id: string;
  livemode?: boolean;
  status?: string;
  customer?: string;
  scopeKey?: string;
  cancelAtPeriodEnd?: boolean;
  periodEnd?: number;
}): Record<string, unknown> {
  return {
    id: options.id,
    object: "event",
    api_version: "2026-11-18.endive",
    created: 1_800_000_000,
    data: {
      object: {
        id: "sub_opencontext",
        object: "subscription",
        status: options.status ?? "active",
        customer: options.customer ?? "cus_opencontext",
        metadata: options.scopeKey
          ? { opencontext_scope: options.scopeKey }
          : {},
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        items: {
          data: [
            {
              id: "si_opencontext",
              current_period_end: options.periodEnd ?? 1_802_592_000,
              price: { id: TEST_PRICE },
            },
          ],
        },
      },
    },
    livemode: options.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "customer.subscription.created",
  };
}

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  authMock.auth.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Stripe billing configuration", () => {
  it("stays disabled when absent, accepts test keys, and rejects accidental live mode", () => {
    expect(resolveStripeBillingConfig({})).toEqual({ kind: "DISABLED" });
    expect(
      resolveStripeBillingConfig({
        STRIPE_SECRET_KEY: TEST_SECRET,
        STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        STRIPE_PRICE_ID: TEST_PRICE,
        APP_BASE_URL: "http://localhost:3000",
        STRIPE_USAGE_BILLING_ENABLED: "true",
      }),
    ).toMatchObject({
      kind: "OK",
      config: { mode: "test", usageBillingEnabled: true },
    });

    const live = {
      STRIPE_SECRET_KEY: "sk_live_not-a-real-key",
      STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      STRIPE_PRICE_ID: TEST_PRICE,
      APP_BASE_URL: "https://opencontext.example",
    };
    expect(resolveStripeBillingConfig(live)).toEqual({ kind: "INVALID" });
    expect(
      resolveStripeBillingConfig({ ...live, STRIPE_ALLOW_LIVE_MODE: "true" }),
    ).toMatchObject({ kind: "OK", config: { mode: "live" } });
  });

  it("rejects partial, malformed, and insecure production configuration", () => {
    expect(
      resolveStripeBillingConfig({ STRIPE_SECRET_KEY: TEST_SECRET }),
    ).toEqual({ kind: "INVALID" });
    expect(
      resolveStripeBillingConfig({
        STRIPE_SECRET_KEY: "not-a-key",
        STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        STRIPE_PRICE_ID: TEST_PRICE,
        APP_BASE_URL: "https://opencontext.example",
      }),
    ).toEqual({ kind: "INVALID" });
    expect(
      resolveStripeBillingConfig({
        STRIPE_SECRET_KEY: TEST_SECRET,
        STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        STRIPE_PRICE_ID: TEST_PRICE,
        APP_BASE_URL: "http://opencontext.example",
      }),
    ).toEqual({ kind: "INVALID" });
  });
});

describe("Stripe subscription flows", () => {
  it("creates a hosted personal checkout and persists one Stripe customer", async () => {
    const user = await createUser();
    const stripe = new Stripe(TEST_SECRET);
    const customersCreate = vi
      .spyOn(stripe.customers, "create")
      .mockResolvedValue({ id: "cus_opencontext" } as never);
    const sessionsCreate = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({
        url: "https://checkout.stripe.com/c/pay/test_session",
      } as never);

    const result = await checkoutSessionForUser(user.id, {
      config: TEST_CONFIG,
      stripe,
    });

    expect(result).toEqual({
      kind: "OK",
      url: "https://checkout.stripe.com/c/pay/test_session",
    });
    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: user.email,
        metadata: {
          opencontext_scope: `user:${user.id}`,
          opencontext_user_id: user.id,
        },
      }),
      { idempotencyKey: `opencontext-customer-test-user:${user.id}` },
    );
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_opencontext",
        client_reference_id: `user:${user.id}`,
        line_items: [{ price: TEST_PRICE, quantity: 1 }],
      }),
    );
    expect(
      await prisma.billingAccount.findUnique({
        where: { scopeKey: `user:${user.id}` },
      }),
    ).toMatchObject({ stripeCustomerId: "cus_opencontext", userId: user.id });
  });

  it("creates a separate Customer when switching from test to live mode", async () => {
    const user = await createUser();
    await prisma.billingAccount.create({
      data: {
        scopeKey: `user:${user.id}`,
        userId: user.id,
        stripeMode: "test",
        stripeCustomerId: "cus_test_old",
        stripeSubscriptionId: "sub_test_old",
        subscriptionStatus: "active",
      },
    });
    const stripe = new Stripe("sk_live_opencontext_unit");
    const customersCreate = vi
      .spyOn(stripe.customers, "create")
      .mockResolvedValue({ id: "cus_live_new" } as never);
    vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/live_session",
    } as never);

    expect(
      await checkoutSessionForUser(user.id, {
        config: LIVE_CONFIG,
        stripe,
      }),
    ).toEqual({
      kind: "OK",
      url: "https://checkout.stripe.com/c/pay/live_session",
    });
    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          opencontext_scope: `user:${user.id}`,
        }),
      }),
      { idempotencyKey: `opencontext-customer-live-user:${user.id}` },
    );
    expect(
      await prisma.billingAccount.findUnique({
        where: { scopeKey: `user:${user.id}` },
      }),
    ).toMatchObject({
      stripeMode: "live",
      stripeCustomerId: "cus_live_new",
      stripeSubscriptionId: null,
      subscriptionStatus: null,
    });
  });

  it("exposes whether usage billing is enabled without returning credentials", async () => {
    const user = await createUser();
    vi.stubEnv("STRIPE_SECRET_KEY", TEST_SECRET);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_PRICE_ID", TEST_PRICE);
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("STRIPE_USAGE_BILLING_ENABLED", "true");

    expect(await billingOverviewForUser(user.id)).toEqual({
      configured: true,
      mode: "test",
      usageBillingEnabled: true,
      canManage: true,
      subscription: null,
    });
  });

  it("enforces team billing management while allowing usage viewers to read status", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const workspace = await createWorkspace(owner.id, "Billing Team");
    if (workspace.kind !== "OK") throw new Error("expected workspace");
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.workspace.id,
        userId: viewer.id,
        role: "VIEWER",
      },
    });

    expect(
      await checkoutSessionForUser(viewer.id, {
        workspaceId: workspace.workspace.id,
        config: TEST_CONFIG,
      }),
    ).toEqual({ kind: "FORBIDDEN" });
    expect(
      await billingOverviewForUser(viewer.id, {
        workspaceId: workspace.workspace.id,
      }),
    ).toMatchObject({ configured: false, canManage: false });
    expect(
      await inputWorkspaceOverview(owner.id, workspace.workspace.id),
    ).toMatchObject({ canManage: true });
  });

  it("opens the hosted portal and rejects scopes without a Stripe customer", async () => {
    const user = await createUser();
    const stripe = new Stripe(TEST_SECRET);
    const portalCreate = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      .mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test",
      } as never);

    expect(
      await portalSessionForUser(user.id, { config: TEST_CONFIG, stripe }),
    ).toEqual({ kind: "NO_CUSTOMER" });
    await prisma.billingAccount.create({
      data: {
        scopeKey: `user:${user.id}`,
        userId: user.id,
        stripeCustomerId: "cus_opencontext",
      },
    });

    expect(
      await portalSessionForUser(user.id, { config: TEST_CONFIG, stripe }),
    ).toEqual({
      kind: "OK",
      url: "https://billing.stripe.com/p/session/test",
    });
    expect(portalCreate).toHaveBeenCalledWith({
      customer: "cus_opencontext",
      return_url: "http://localhost:3000/app/usage",
    });
  });
});

async function inputWorkspaceOverview(userId: string, workspaceId: string) {
  return billingOverviewForUser(userId, { workspaceId });
}

describe("Stripe webhook synchronization", () => {
  it("verifies signatures, updates subscription state, and deduplicates event IDs", async () => {
    const user = await createUser();
    await prisma.billingAccount.create({
      data: {
        scopeKey: `user:${user.id}`,
        userId: user.id,
        stripeCustomerId: "cus_opencontext",
      },
    });
    const payload = JSON.stringify(
      subscriptionEvent({
        id: "evt_opencontext_active",
        scopeKey: `user:${user.id}`,
        cancelAtPeriodEnd: true,
      }),
    );
    const stripe = new Stripe(TEST_SECRET);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_WEBHOOK_SECRET,
    });

    expect(
      await processStripeWebhook(payload, signature, {
        config: TEST_CONFIG,
        stripe,
      }),
    ).toEqual({ kind: "PROCESSED", handled: true });
    expect(
      await prisma.billingAccount.findUnique({
        where: { scopeKey: `user:${user.id}` },
      }),
    ).toMatchObject({
      stripeSubscriptionId: "sub_opencontext",
      stripePriceId: TEST_PRICE,
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
    });
    expect(
      await processStripeWebhook(payload, signature, {
        config: TEST_CONFIG,
        stripe,
      }),
    ).toEqual({ kind: "DUPLICATE" });
    expect(await prisma.stripeWebhookEvent.count()).toBe(1);
    expect(
      await checkoutSessionForUser(user.id, { config: TEST_CONFIG }),
    ).toEqual({ kind: "ALREADY_SUBSCRIBED" });
  });

  it("rejects tampered payloads and mismatched test/live events", async () => {
    const payload = JSON.stringify(subscriptionEvent({ id: "evt_bad_sig" }));
    const stripe = new Stripe(TEST_SECRET);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_WEBHOOK_SECRET,
    });
    expect(
      await processStripeWebhook(`${payload} `, signature, {
        config: TEST_CONFIG,
        stripe,
      }),
    ).toEqual({ kind: "INVALID_SIGNATURE" });

    const livePayload = JSON.stringify(
      subscriptionEvent({ id: "evt_wrong_mode", livemode: true }),
    );
    const liveSignature = stripe.webhooks.generateTestHeaderString({
      payload: livePayload,
      secret: TEST_WEBHOOK_SECRET,
    });
    expect(
      await processStripeWebhook(livePayload, liveSignature, {
        config: TEST_CONFIG,
        stripe,
      }),
    ).toEqual({ kind: "INVALID_MODE" });
  });

  it("serves authenticated status and configuration-safe billing APIs", async () => {
    const user = await createUser();
    asUser(null);
    expect(
      (await statusGet(new Request("http://localhost/api/billing/status")))
        .status,
    ).toBe(401);

    asUser(user.id);
    const status = await statusGet(
      new Request("http://localhost/api/billing/status"),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      configured: false,
      mode: null,
      usageBillingEnabled: false,
      canManage: true,
      subscription: null,
    });

    const checkout = await checkoutPost(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: null }),
      }),
    );
    expect(checkout.status).toBe(503);
    expect(await checkout.json()).toMatchObject({
      error: { code: "BILLING_UNAVAILABLE" },
    });

    const webhook = await webhookPost(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=1,v1=invalid",
        },
        body: JSON.stringify(subscriptionEvent({ id: "evt_api_unconfigured" })),
      }),
    );
    expect(webhook.status).toBe(503);
  });
});
