import { z } from "zod";

export const BillingScopeRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

export type BillingScopeRequest = z.infer<typeof BillingScopeRequestSchema>;

export const BillingSubscriptionStatusSchema = z.enum([
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
]);

export type BillingSubscriptionStatus = z.infer<
  typeof BillingSubscriptionStatusSchema
>;

export const BillingSubscriptionSummarySchema = z
  .object({
    status: BillingSubscriptionStatusSchema,
    currentPeriodEnd: z.iso.datetime().nullable(),
    cancelAtPeriodEnd: z.boolean(),
  })
  .strict();

export const BillingOverviewSchema = z
  .object({
    configured: z.boolean(),
    mode: z.enum(["test", "live"]).nullable(),
    usageBillingEnabled: z.boolean(),
    canManage: z.boolean(),
    subscription: BillingSubscriptionSummarySchema.nullable(),
  })
  .strict();

export type BillingOverview = z.infer<typeof BillingOverviewSchema>;

export const BillingRedirectSchema = z
  .object({
    url: z.url(),
  })
  .strict();

export type BillingRedirect = z.infer<typeof BillingRedirectSchema>;
