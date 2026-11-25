"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ApiError,
  fetchUsageSummary,
} from "@/components/app/api-client";
import { formatDate } from "@/components/results/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  workspaces: { id: string; name: string; role: string }[];
}

export function UsageDashboard({
  initialSummary,
  workspaces,
}: UsageDashboardProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [workspaceId, setWorkspaceId] = useState(
    initialSummary.workspaceId ?? "",
  );
  const [days, setDays] = useState(initialSummary.days);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(nextWorkspaceId: string, nextDays: number) {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchUsageSummary({
        workspaceId: nextWorkspaceId || undefined,
        days: nextDays,
      });
      setSummary(next);
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="label-mono">Analyses recorded</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {summary.totalRecords}
          </p>
          <p className="mt-1 text-xs text-ink-faint">Last {summary.days} days</p>
        </Card>
        <Card>
          <p className="label-mono">Timed media processed</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-ink">
            {formatDurationSeconds(summary.totalMediaSeconds)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">Video and audio duration</p>
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
        <h2 className="text-base font-semibold text-ink">Recent usage ledger</h2>
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
