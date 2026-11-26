"use client";

import { useState } from "react";
import Link from "next/link";
import type { BillingOverview } from "@kylosonic/opencontext-schemas";
import {
  ApiError,
  fetchBillingOverview,
  fetchUsageSummary,
  openBillingPortal,
  startBillingCheckout,
} from "@/components/app/api-client";
import { formatDate } from "@/components/results/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UsageDashboardSummary } from "@/server/billing/usage";

function formatUsdFromMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatDurationSeconds(totalSec: number): string {
  const rounded = Math.round(totalSec);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export interface UsageDashboardProps {
  initialSummary: UsageDashboardSummary;
  initialBilling: BillingOverview;
  workspaces: { id: string; name: string; role: string }[];
  initialInvoiceMonth: string;
}

export function UsageDashboard({
  initialSummary,
  initialBilling,
  workspaces,
  initialInvoiceMonth,
}: UsageDashboardProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [billing, setBilling] = useState(initialBilling);
  const [workspaceId, setWorkspaceId] = useState(
    initialSummary.workspaceId ?? "",
  );
  const [days, setDays] = useState(initialSummary.days);
  const [invoiceMonth, setInvoiceMonth] = useState(initialInvoiceMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  async function reload(nextWorkspaceId: string, nextDays: number) {
    setLoading(true);
    setError(null);
    try {
      const [next, nextBilling] = await Promise.all([
        fetchUsageSummary({
          workspaceId: nextWorkspaceId || undefined,
          days: nextDays,
        }),
        fetchBillingOverview(nextWorkspaceId || undefined),
      ]);
      setSummary(next);
      setBilling(nextBilling);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load usage history.",
      );
    } finally {
      setLoading(false);
    }
  }

  function invoiceHref(format: "json" | "csv"): string {
    const params = new URLSearchParams({ month: invoiceMonth, format });
    if (workspaceId) params.set("workspaceId", workspaceId);
    return `/api/usage/invoice?${params.toString()}`;
  }

  async function openBilling(action: "checkout" | "portal") {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingError(null);
    try {
      const url =
        action === "checkout"
          ? await startBillingCheckout(workspaceId)
          : await openBillingPortal(workspaceId);
      window.location.assign(url);
    } catch (caught) {
      setBillingError(
        caught instanceof ApiError
          ? caught.message
          : "Could not open Stripe billing.",
      );
      setBillingBusy(false);
    }
  }

  return (
    <div className="space-y-6" aria-busy={loading}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="grid gap-1 text-xs font-medium text-ink-muted">
              Scope
              <select
                value={workspaceId}
                aria-label="Usage scope"
                disabled={loading}
                onChange={(event) => {
                  const next = event.target.value;
                  setWorkspaceId(next);
                  void reload(next, days);
                }}
                className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-normal text-ink"
              >
                <option value="">Personal (your analyses)</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    Team: {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-ink-muted">
              Window
              <select
                value={days}
                aria-label="Usage window"
                disabled={loading}
                onChange={(event) => {
                  const nextDays = Number(event.target.value);
                  setDays(nextDays);
                  void reload(workspaceId, nextDays);
                }}
                className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-normal text-ink"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void reload(workspaceId, days)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-err">
            {error}
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">
                Subscription billing
              </h2>
              {billing.mode && (
                <Badge
                  tone={billing.mode === "test" ? "warning" : "accent"}
                  mono
                >
                  {billing.mode.toUpperCase()}
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Manage the recurring OpenContext plan through Stripe-hosted
              Checkout and Billing Portal. Usage billing is enabled for the
              ledger in this deployment and can be viewed in the monthly invoice
              export.
            </p>
          </div>
          {billing.canManage && billing.configured && (
            <Button
              type="button"
              size="sm"
              disabled={billingBusy}
              onClick={() =>
                void openBilling(billing.subscription ? "portal" : "checkout")
              }
            >
              {billingBusy
                ? "Opening Stripe…"
                : billing.subscription
                  ? "Manage billing"
                  : "Start subscription"}
            </Button>
          )}
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-md border border-line bg-panel-muted/50 p-3">
            <dt className="text-xs text-ink-faint">Status</dt>
            <dd className="mt-1 font-medium text-ink">
              {billing.subscription?.status ?? "Not subscribed"}
            </dd>
          </div>
          <div className="rounded-md border border-line bg-panel-muted/50 p-3">
            <dt className="text-xs text-ink-faint">Current period ends</dt>
            <dd className="mt-1 font-medium text-ink">
              {billing.subscription?.currentPeriodEnd
                ? formatDate(billing.subscription.currentPeriodEnd)
                : "—"}
            </dd>
          </div>
          <div className="rounded-md border border-line bg-panel-muted/50 p-3">
            <dt className="text-xs text-ink-faint">Renewal</dt>
            <dd className="mt-1 font-medium text-ink">
              {billing.subscription?.cancelAtPeriodEnd
                ? "Cancels at period end"
                : billing.subscription
                  ? "Automatic"
                  : "—"}
            </dd>
          </div>
        </dl>

        {!billing.configured && (
          <p className="mt-4 rounded-md border border-line bg-panel-muted/50 p-3 text-sm text-ink-muted">
            Stripe billing is disabled on this deployment. Configure the
            test-mode server key, webhook secret, price ID, and app base URL to
            enable it.
          </p>
        )}
        {billing.configured && !billing.canManage && (
          <p className="mt-4 text-xs text-ink-faint">
            Your team role can view billing status but cannot start or manage
            the subscription.
          </p>
        )}
        {billing.configured && !billing.usageBillingEnabled && (
          <p className="mt-4 text-xs text-ink-faint">
            Usage charges are not submitted to Stripe on this deployment. Only
            the recurring subscription price is active.
          </p>
        )}
        {billingError && (
          <p role="alert" className="mt-3 text-sm text-err">
            {billingError}
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Monthly invoice export
            </h2>
            <p className="mt-1 max-w-xl text-xs text-ink-faint">
              Download the usage ledger for the selected scope. When usage
              billing is enabled, positive usage is also submitted to Stripe as
              an invoice item and appears on the next invoice.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium text-ink-muted">
              Invoice month
              <input
                type="month"
                min="2000-01"
                max="2100-12"
                value={invoiceMonth}
                onChange={(event) => setInvoiceMonth(event.target.value)}
                className="h-8 rounded-md border border-line bg-canvas px-2 text-sm font-normal text-ink"
              />
            </label>
            <a
              href={invoiceHref("json")}
              download
              className={buttonClasses("secondary", "sm")}
            >
              JSON invoice
            </a>
            <a
              href={invoiceHref("csv")}
              download
              className={buttonClasses("secondary", "sm")}
            >
              CSV invoice
            </a>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="label-mono">Analyses recorded</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {summary.totalRecords}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Last {summary.days} days
          </p>
        </Card>
        <Card>
          <p className="label-mono">Timed media processed</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {formatDurationSeconds(summary.totalMediaSeconds)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Video and audio duration
          </p>
        </Card>
        <Card>
          <p className="label-mono">Still &amp; document jobs</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {summary.totalStillJobs}
          </p>
          <p className="mt-1 text-xs text-ink-faint">Images, sets, and PDFs</p>
        </Card>
        <Card>
          <p className="label-mono">Recorded resale cost</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {formatUsdFromMicros(summary.totalCostMicros)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {summary.totalCostMicros === 0
              ? "Operator rates are $0.00 until priced"
              : "Computed from configured unit rates"}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-ink">By detail level</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            {(["LOW", "MEDIUM", "HIGH"] as const).map((level) => (
              <div
                key={level}
                className="rounded-md border border-line bg-panel-muted/50 p-3"
              >
                <dt className="font-mono text-xs text-ink-faint">{level}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-ink">
                  {summary.byDetailLevel[level]}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-ink">By media format</h2>
          <dl className="mt-3 grid grid-cols-4 gap-3 text-sm">
            {(["video", "audio", "image", "pdf"] as const).map((kind) => (
              <div
                key={kind}
                className="rounded-md border border-line bg-panel-muted/50 p-3"
              >
                <dt className="font-mono text-xs uppercase text-ink-faint">
                  {kind}
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-ink">
                  {summary.bySourceKind[kind]}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="text-base font-semibold text-ink">
          Recent usage ledger
        </h2>
        {summary.recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No completed or partial analyses have been recorded in this window.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {summary.recent.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  {entry.jobId ? (
                    <Link
                      href={`/app/jobs/${encodeURIComponent(entry.jobId)}`}
                      className="block truncate font-medium text-ink hover:text-accent"
                    >
                      {entry.jobDisplayName ?? entry.jobId}
                    </Link>
                  ) : (
                    <span className="block truncate text-ink-muted">
                      Deleted job
                    </span>
                  )}
                  <span className="text-xs text-ink-faint">
                    {formatDate(entry.createdAt)} ·{" "}
                    {entry.unit === "media-second"
                      ? `${entry.quantity.toFixed(1)}s`
                      : `${entry.quantity} job`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {entry.detailLevel && (
                    <Badge tone="neutral" mono>
                      {entry.detailLevel}
                    </Badge>
                  )}
                  <Badge tone="neutral" mono>
                    {entry.sourceKind.toUpperCase()}
                  </Badge>
                  {entry.workspaceName && (
                    <Badge tone="accent">{entry.workspaceName}</Badge>
                  )}
                  <span className="font-mono text-xs text-ink">
                    {formatUsdFromMicros(entry.totalCostMicros)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
