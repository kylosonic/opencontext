import Stripe from "stripe";
import {
  BillingOverviewSchema,
  BillingSubscriptionStatusSchema,
  type BillingOverview,
  type BillingSubscriptionStatus,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { hasWorkspacePermission } from "@/server/workspaces";

type EnvRecord = Record<string, string | undefined>;

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  baseUrl: string;
  mode: "test" | "live";
  usageBillingEnabled: boolean;
}

export type StripeBillingConfigResult =
  | { kind: "OK"; config: StripeBillingConfig }
  | { kind: "DISABLED" }
  | { kind: "INVALID" };

function envValue(env: EnvRecord, name: string): string {
  return env[name]?.trim() ?? "";
}

function truthy(value: string): boolean {
  return /^(?:1|true|yes|on)$/i.test(value.trim());
}

function normalizedBaseUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname.toLowerCase(),
  );
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    return null;
  }
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Stripe is optional and fail-closed. Live-mode keys require both an explicit
 * operator override and a fully valid configuration.
 */
export function resolveStripeBillingConfig(
  env: EnvRecord = process.env,
): StripeBillingConfigResult {
  const secretKey = envValue(env, "STRIPE_SECRET_KEY");
  const webhookSecret = envValue(env, "STRIPE_WEBHOOK_SECRET");
  const priceId = envValue(env, "STRIPE_PRICE_ID");
  const baseUrl = normalizedBaseUrl(envValue(env, "APP_BASE_URL"));

  if (!secretKey && !webhookSecret && !priceId) return { kind: "DISABLED" };
  if (!secretKey || !webhookSecret || !priceId || !baseUrl) {
    return { kind: "INVALID" };
  }

  const testKey =
    secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
  const liveKey =
    secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  if ((!testKey && !liveKey) || !webhookSecret.startsWith("whsec_")) {
    return { kind: "INVALID" };
  }
  if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) return { kind: "INVALID" };
  if (liveKey && !truthy(envValue(env, "STRIPE_ALLOW_LIVE_MODE"))) {
    return { kind: "INVALID" };
  }

  return {
    kind: "OK",
    config: {
      secretKey,
      webhookSecret,
      priceId,
      baseUrl,
      mode: liveKey ? "live" : "test",
      usageBillingEnabled: truthy(
        envValue(env, "STRIPE_USAGE_BILLING_ENABLED"),
      ),
    },
  };
}

let cachedClient: { secretKey: string; client: Stripe } | null = null;

/** Create or reuse the server-only Stripe SDK client for the active key. */
export function createStripeClient(config: StripeBillingConfig): Stripe {
  if (cachedClient?.secretKey === config.secretKey) return cachedClient.client;
  const client = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    timeout: 15_000,
    appInfo: { name: "OpenContext" },
  });
  cachedClient = { secretKey: config.secretKey, client };
  return client;
}

interface BillingScope {
  scopeKey: string;
  userId: string | null;
  workspaceId: string | null;
  customerEmail: string | null;
  customerName: string;
  canManage: boolean;
}

type ScopePermission = "usage:view" | "billing:manage";

async function resolveBillingScope(
  userId: string,
  workspaceId: string | undefined,
  permission: ScopePermission,
): Promise<BillingScope | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) return null;

  if (!workspaceId) {
    return {
      scopeKey: `user:${userId}`,
      userId,
      workspaceId: null,
      customerEmail: user.email,
      customerName: user.name?.trim() || "OpenContext customer",
      canManage: true,
    };
  }

  const allowed = await hasWorkspacePermission(workspaceId, userId, permission);
  if (!allowed) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) return null;

  return {
    scopeKey: `workspace:${workspace.id}`,
    userId: null,
    workspaceId: workspace.id,
    customerEmail: user.email,
    customerName: workspace.name,
    canManage: await hasWorkspacePermission(
      workspace.id,
      userId,
      "billing:manage",
    ),
  };
}

function configuredMode(
  result: StripeBillingConfigResult,
): "test" | "live" | null {
  return result.kind === "OK" ? result.config.mode : null;
}

/** Read billing state for a personal or team scope the caller can access. */
export async function billingOverviewForUser(
  userId: string,
  options: { workspaceId?: string } = {},
): Promise<BillingOverview | null> {
  const workspaceId = options.workspaceId?.trim() || undefined;
  const scope = await resolveBillingScope(userId, workspaceId, "usage:view");
  if (!scope) return null;

  const config = resolveStripeBillingConfig();
  const account = await prisma.billingAccount.findUnique({
    where: { scopeKey: scope.scopeKey },
  });
  const parsedStatus = BillingSubscriptionStatusSchema.safeParse(
    account?.subscriptionStatus,
  );
  const accountMatchesMode =
    config.kind !== "OK" || account?.stripeMode === config.config.mode;

  return BillingOverviewSchema.parse({
    configured: config.kind === "OK",
    mode: configuredMode(config),
    usageBillingEnabled:
      config.kind === "OK" && config.config.usageBillingEnabled,
    canManage: scope.canManage,
    subscription:
      accountMatchesMode &&
      account?.stripeSubscriptionId &&
      parsedStatus.success
        ? {
            status: parsedStatus.data,
            currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: account.cancelAtPeriodEnd,
          }
        : null,
  });
}

function customerMetadata(scope: BillingScope): Record<string, string> {
  const metadata: Record<string, string> = {
    opencontext_scope: scope.scopeKey,
  };
  if (scope.userId) metadata.opencontext_user_id = scope.userId;
  if (scope.workspaceId) metadata.opencontext_workspace_id = scope.workspaceId;
  return metadata;
}

async function ensureStripeCustomer(
  stripe: Stripe,
  scope: BillingScope,
  mode: "test" | "live",
): Promise<string> {
  const existing = await prisma.billingAccount.findUnique({
    where: { scopeKey: scope.scopeKey },
    select: { stripeCustomerId: true, stripeMode: true },
  });
  if (existing?.stripeMode === mode) return existing.stripeCustomerId;

  const customer = await stripe.customers.create(
    {
      ...(scope.customerEmail ? { email: scope.customerEmail } : {}),
      name: scope.customerName,
      metadata: customerMetadata(scope),
    },
    { idempotencyKey: `opencontext-customer-${mode}-${scope.scopeKey}` },
  );
  const account = await prisma.billingAccount.upsert({
    where: { scopeKey: scope.scopeKey },
    create: {
      scopeKey: scope.scopeKey,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      stripeMode: mode,
      stripeCustomerId: customer.id,
    },
    update: {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      stripeMode: mode,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: null,
      stripePriceId: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
    select: { stripeCustomerId: true },
  });
  return account.stripeCustomerId;
}

export type CheckoutSessionResult =
  | { kind: "OK"; url: string }
  | { kind: "UNAVAILABLE" }
  | { kind: "FORBIDDEN" }
  | { kind: "ALREADY_SUBSCRIBED" };

function statusBlocksNewCheckout(status: string | null): boolean {
  return Boolean(
    status && !["canceled", "incomplete_expired"].includes(status),
  );
}

/** Create a Stripe-hosted subscription Checkout session for a caller. */
export async function checkoutSessionForUser(
  userId: string,
  options: {
    workspaceId?: string;
    config?: StripeBillingConfigResult;
    stripe?: Stripe;
  } = {},
): Promise<CheckoutSessionResult> {
  const configResult = options.config ?? resolveStripeBillingConfig();
  if (configResult.kind !== "OK") return { kind: "UNAVAILABLE" };
  const workspaceId = options.workspaceId?.trim() || undefined;
  const scope = await resolveBillingScope(
    userId,
    workspaceId,
    "billing:manage",
  );
  if (!scope) return { kind: "FORBIDDEN" };

  const account = await prisma.billingAccount.findUnique({
    where: { scopeKey: scope.scopeKey },
    select: {
      stripeMode: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
    },
  });
  if (
    account?.stripeMode === configResult.config.mode &&
    (account.stripeSubscriptionId ||
      statusBlocksNewCheckout(account.subscriptionStatus))
  ) {
    return { kind: "ALREADY_SUBSCRIBED" };
  }

  try {
    const stripe = options.stripe ?? createStripeClient(configResult.config);
    const customerId = await ensureStripeCustomer(
      stripe,
      scope,
      configResult.config.mode,
    );
    const successUrl = new URL("/app/usage", configResult.config.baseUrl);
    successUrl.searchParams.set("billing", "success");
    if (scope.workspaceId)
      successUrl.searchParams.set("workspaceId", scope.workspaceId);
    const cancelUrl = new URL("/app/usage", configResult.config.baseUrl);
    cancelUrl.searchParams.set("billing", "cancelled");
    if (scope.workspaceId)
      cancelUrl.searchParams.set("workspaceId", scope.workspaceId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: scope.scopeKey,
      line_items: [{ price: configResult.config.priceId, quantity: 1 }],
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      allow_promotion_codes: true,
      metadata: customerMetadata(scope),
      subscription_data: { metadata: customerMetadata(scope) },
    });
    return session.url
      ? { kind: "OK", url: session.url }
      : { kind: "UNAVAILABLE" };
  } catch (error) {
    console.error(
      "Stripe Checkout creation failed:",
      error instanceof Stripe.errors.StripeError ? error.type : "unknown error",
    );
    return { kind: "UNAVAILABLE" };
  }
}

export type PortalSessionResult =
  | { kind: "OK"; url: string }
  | { kind: "UNAVAILABLE" }
  | { kind: "FORBIDDEN" }
  | { kind: "NO_CUSTOMER" };

/** Open Stripe's hosted Billing Portal for an existing customer. */
export async function portalSessionForUser(
  userId: string,
  options: {
    workspaceId?: string;
    config?: StripeBillingConfigResult;
    stripe?: Stripe;
  } = {},
): Promise<PortalSessionResult> {
  const configResult = options.config ?? resolveStripeBillingConfig();
  if (configResult.kind !== "OK") return { kind: "UNAVAILABLE" };
  const workspaceId = options.workspaceId?.trim() || undefined;
  const scope = await resolveBillingScope(
    userId,
    workspaceId,
    "billing:manage",
  );
  if (!scope) return { kind: "FORBIDDEN" };

  const account = await prisma.billingAccount.findUnique({
    where: { scopeKey: scope.scopeKey },
    select: { stripeCustomerId: true, stripeMode: true },
  });
  if (!account || account.stripeMode !== configResult.config.mode) {
    return { kind: "NO_CUSTOMER" };
  }

  try {
    const stripe = options.stripe ?? createStripeClient(configResult.config);
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: new URL("/app/usage", configResult.config.baseUrl).toString(),
    });
    return { kind: "OK", url: session.url };
  } catch (error) {
    console.error(
      "Stripe Billing Portal creation failed:",
      error instanceof Stripe.errors.StripeError ? error.type : "unknown error",
    );
    return { kind: "UNAVAILABLE" };
  }
}

interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string>;
  cancel_at_period_end?: boolean;
  items?: {
    data?: Array<{
      current_period_end?: number;
      price?: { id?: string };
    }>;
  };
}

function objectId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

function subscriptionState(subscription: StripeSubscriptionLike): {
  status: BillingSubscriptionStatus;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
} | null {
  const status = BillingSubscriptionStatusSchema.safeParse(subscription.status);
  if (!status.success) return null;
  const items = subscription.items?.data ?? [];
  const periodEndSeconds = items.reduce(
    (latest, item) => Math.max(latest, item.current_period_end ?? 0),
    0,
  );
  return {
    status: status.data,
    priceId: items[0]?.price?.id ?? null,
    currentPeriodEnd:
      periodEndSeconds > 0 ? new Date(periodEndSeconds * 1_000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
  };
}

async function findAccountForSubscription(
  subscription: StripeSubscriptionLike,
) {
  const customerId = objectId(subscription.customer);
  return prisma.billingAccount.findUnique({
    where: { stripeCustomerId: customerId },
  });
}

async function syncSubscription(
  subscription: StripeSubscriptionLike,
  eventType: string,
): Promise<boolean> {
  const account = await findAccountForSubscription(subscription);
  if (!account) return false;
  const effective =
    eventType === "customer.subscription.deleted"
      ? { ...subscription, status: "canceled" }
      : subscription;
  const state = subscriptionState(effective);
  if (!state) return false;

  await prisma.billingAccount.update({
    where: { id: account.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: state.priceId,
      subscriptionStatus: state.status,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    },
  });
  return true;
}

export type StripeWebhookResult =
  | { kind: "PROCESSED"; handled: boolean }
  | { kind: "DUPLICATE" }
  | { kind: "INVALID_SIGNATURE" }
  | { kind: "INVALID_MODE" }
  | { kind: "UNAVAILABLE" }
  | { kind: "PROVIDER_ERROR" };

/** Verify and apply one Stripe webhook event idempotently. */
export async function processStripeWebhook(
  payload: string,
  signature: string | null,
  options: {
    config?: StripeBillingConfigResult;
    stripe?: Stripe;
  } = {},
): Promise<StripeWebhookResult> {
  const configResult = options.config ?? resolveStripeBillingConfig();
  if (configResult.kind !== "OK") return { kind: "UNAVAILABLE" };
  if (!signature) return { kind: "INVALID_SIGNATURE" };

  let event: Stripe.Event;
  try {
    const stripe = options.stripe ?? createStripeClient(configResult.config);
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      configResult.config.webhookSecret,
    );
  } catch {
    return { kind: "INVALID_SIGNATURE" };
  }

  if (event.livemode !== (configResult.config.mode === "live")) {
    return { kind: "INVALID_MODE" };
  }
  const alreadyProcessed = await prisma.stripeWebhookEvent.findUnique({
    where: { id: event.id },
    select: { id: true },
  });
  if (alreadyProcessed) return { kind: "DUPLICATE" };

  let handled = false;
  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      handled = await syncSubscription(
        event.data.object as unknown as StripeSubscriptionLike,
        event.type,
      );
    } else if (event.type === "checkout.session.completed") {
      const session = event.data.object as unknown as {
        customer: string | { id: string } | null;
        client_reference_id?: string | null;
        subscription?: string | { id: string } | null;
      };
      let subscription: StripeSubscriptionLike | null = null;
      if (session.subscription && typeof session.subscription === "object") {
        subscription =
          session.subscription as unknown as StripeSubscriptionLike;
      } else if (session.subscription) {
        const stripe =
          options.stripe ?? createStripeClient(configResult.config);
        subscription = (await stripe.subscriptions.retrieve(
          session.subscription,
        )) as unknown as StripeSubscriptionLike;
      }
      if (subscription) {
        if (
          session.client_reference_id &&
          !subscription.metadata?.opencontext_scope
        ) {
          subscription = {
            ...subscription,
            metadata: {
              ...(subscription.metadata ?? {}),
              opencontext_scope: session.client_reference_id,
            },
          };
        }
        handled = await syncSubscription(subscription, event.type);
      }
    }

    await prisma.stripeWebhookEvent.create({
      data: { id: event.id, type: event.type, livemode: event.livemode },
    });
    return { kind: "PROCESSED", handled };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { kind: "DUPLICATE" };
    }
    console.error(
      "Stripe webhook processing failed:",
      error instanceof Stripe.errors.StripeError ? error.type : "unknown error",
    );
    return { kind: "PROVIDER_ERROR" };
  }
}
