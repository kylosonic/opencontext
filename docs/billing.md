# Stripe Subscription Billing

OpenContext supports optional Stripe-hosted subscription Checkout and Billing
Portal flows. Billing is disabled unless every required value is present. This
keeps local, preview, and unconfigured deployments usable without payment
credentials.

## Required configuration

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
STRIPE_USAGE_BILLING_ENABLED=true
BILLING_ANALYSIS_MICROS_PER_SECOND=250
BILLING_STILL_JOB_MICROS=7500
APP_BASE_URL=https://your-app.example
# STRIPE_ALLOW_LIVE_MODE=false
```

`STRIPE_PRICE_ID` must identify a recurring Price. `APP_BASE_URL` must be HTTPS
outside localhost. Standard and restricted test keys are accepted. Live keys
(`sk_live_` or `rk_live_`) remain disabled unless the deployment owner also sets
`STRIPE_ALLOW_LIVE_MODE=true`.

## Stripe dashboard setup

1. Create an `OpenContext` product with one recurring monthly or annual Price.
   Start with a $0 test Price when validating usage-only billing, or a paid
   Price for a base subscription plus usage.
2. Copy the Test mode Price ID into `STRIPE_PRICE_ID`.
3. Add a webhook endpoint at `https://your-app.example/api/stripe/webhook`.
4. Subscribe it to `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, and
   `customer.subscription.deleted`.
5. Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Configure branding, cancellation behavior, and allowed payment methods in
   the Stripe Billing Portal configuration.
7. Set positive `BILLING_ANALYSIS_MICROS_PER_SECOND` and/or
   `BILLING_STILL_JOB_MICROS` values. Zero rates keep usage records in the local
   ledger but do not create Stripe charges.
8. Use Stripe's test card and test clocks while validating behavior. Test-mode
   objects do not create real charges.

## Application behavior

- `/app/usage` shows the configured test/live mode and current subscription.
- Personal scopes can be managed by their signed-in owner.
- Team scopes require `billing:manage`; `OWNER` and `ADMIN` receive it by
  default, and custom roles may opt in.
- Checkout creates one persistent Stripe Customer per personal or team scope.
  The customer and subscription IDs are stored in `BillingAccount` without
  storing payment-card details.
- Billing Portal links are created server-side and open only for the authorized
  scope.
- Webhooks verify the raw payload signature, reject mismatched test/live events,
  and deduplicate event IDs through `StripeWebhookEvent`. Subscription status,
  current period end, Price, and cancellation state are synchronized
  idempotently.
- With `STRIPE_USAGE_BILLING_ENABLED=true`, positive analysis records create
  one Stripe invoice item per usage event when the scope has an active,
  trialing, past-due, or unpaid subscription. The database-level usage ID unique
  constraint and Stripe idempotency key make retries safe.
- Usage is stored in micro-USD and rounded up to whole cents, so a positive
  amount is never silently billed as zero.
- A missing subscription leaves the event `PENDING`. Provider failures leave it
  `FAILED` without failing job completion. The authenticated operations
  reconciliation endpoint retries up to 10 attempts for 30 days.

## Deliberate boundaries

The recurring subscription and the usage ledger use separate controls. Usage
charges require `STRIPE_USAGE_BILLING_ENABLED=true`, positive resale rates, and
a billable subscription. `/app/usage` also continues to show the recorded
analysis quantities and deterministic JSON/CSV draft exports. Automatic
provider-cost pass-through, tax calculation, final invoice issuance, refund
automation, and a custom dunning policy remain out of scope. Use Stripe Billing
for final invoices and configure its tax and recovery settings explicitly.

## Verification checklist

Use Stripe test mode and confirm all of the following before enabling live mode:

1. Checkout creates a Customer for the signed-in scope and records a subscription.
2. Signed `checkout.session.completed` and subscription webhooks update the
   `BillingAccount` without duplicate event processing.
3. Billing Portal opens for that Customer.
4. A completed priced analysis creates exactly one invoice item with the
   expected cent amount and `opencontext-usage-*` idempotency key.
5. Re-running usage reconciliation does not create a second item.
6. A provider outage leaves the row `FAILED`, and reconciliation can move it to
   `SYNCED`.

Never place a Stripe secret key in source, test snapshots, logs, or browser code.
Rotate a key immediately if it is exposed. Do not enable live mode until the
price, tax, refund, cancellation, customer-support, and accounting policies have
been explicitly approved.
