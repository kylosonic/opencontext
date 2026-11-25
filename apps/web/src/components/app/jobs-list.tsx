"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { JobSummary } from "@kylosonic/opencontext-schemas";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { formatDate } from "@/components/results/format";
import {
  isActiveStatus,
  POLL_INTERVAL_MS,
  stageDisplayName,
} from "@/server/jobs/jobViews";
import {
  ApiError,
  deleteJobRequest,
  fetchJobsList,
  isSignInError,
} from "./api-client";
import { ConfirmDialog } from "./confirm-dialog";
import { JobStatusBadge } from "./job-status";

interface JobsListProps {
  /** Server-rendered first frame (listJobs, newest first). */
  initialJobs: JobSummary[];
  /** Optional workspaces for filtering team vs personal jobs. */
  workspaces?: { id: string; name: string }[];
}

type FatalState =
  | { kind: "signed-out" }
  | { kind: "load-error"; message: string };

/**
 * The signed-in user's job list (jobs.md B8/B10).
 * Supports search/filter controls and polls every 3s while any job is active.
 */
export function JobsList({ initialJobs, workspaces = [] }: JobsListProps) {
  const [jobs, setJobs] = useState<JobSummary[]>(initialJobs);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [sourceKindFilter, setSourceKindFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [fatal, setFatal] = useState<FatalState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<JobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pollEpochRef = useRef(0);
  const filterMountedRef = useRef(false);

  const hasFilters = Boolean(
    query.trim() || statusFilter || workspaceFilter || sourceKindFilter,
  );
  const hasActive = jobs.some((job) => isActiveStatus(job.status));

  const refresh = useCallback(
    async (notify = false) => {
      try {
        const next = await fetchJobsList({
          q: query,
          status: statusFilter,
          workspaceId: workspaceFilter,
          sourceKind: sourceKindFilter,
        });
        setJobs(next);
        setFatal(null);
        setReconnecting(false);
      } catch (error) {
        if (isSignInError(error)) {
          setFatal({ kind: "signed-out" });
          return;
        }
        setReconnecting(true);
        if (notify) {
          setFatal({
            kind: "load-error",
            message:
              error instanceof ApiError
                ? error.message
                : "Could not load your jobs — check your connection.",
          });
        }
      }
    },
    [query, statusFilter, workspaceFilter, sourceKindFilter],
  );

  // Refetch when user changes search or dropdown filters.
  useEffect(() => {
    if (!filterMountedRef.current) {
      filterMountedRef.current = true;
      return;
    }
    let cancelled = false;
    const delayMs = query ? 200 : 0;
    const timer = window.setTimeout(() => {
      setFiltering(true);
      void fetchJobsList({
        q: query,
        status: statusFilter,
        workspaceId: workspaceFilter,
        sourceKind: sourceKindFilter,
      })
        .then((next) => {
          if (cancelled) return;
          setJobs(next);
          setFatal(null);
          setReconnecting(false);
        })
        .catch((error) => {
          if (cancelled) return;
          if (isSignInError(error)) {
            setFatal({ kind: "signed-out" });
            return;
          }
          setReconnecting(true);
        })
        .finally(() => {
          if (!cancelled) setFiltering(false);
        });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, statusFilter, workspaceFilter, sourceKindFilter]);

  // Poll every 3 seconds while any job is active (jobs.md B3).
  useEffect(() => {
    if (fatal || !hasActive) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      const epoch = pollEpochRef.current;
      try {
        const next = await fetchJobsList({
          q: query,
          status: statusFilter,
          workspaceId: workspaceFilter,
          sourceKind: sourceKindFilter,
        });
        if (stopped || epoch !== pollEpochRef.current) return;
        setJobs(next);
        setReconnecting(false);
      } catch (error) {
        if (stopped || epoch !== pollEpochRef.current) return;
        if (isSignInError(error)) {
          setFatal({ kind: "signed-out" });
          return;
        }
        // B3: the displayed list never changes because of a poll failure.
        setReconnecting(true);
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [hasActive, fatal, query, statusFilter, workspaceFilter, sourceKindFilter]);

  function clearFilters() {
    setQuery("");
    setStatusFilter("");
    setWorkspaceFilter("");
    setSourceKindFilter("");
  }

  function closeDelete(): void {
    if (deleteBusy) return;
    setDeleting(null);
    setDeleteError(null);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteJobRequest(deleting.id);
      // Optimistic removal - no full-list refetch needed.
      pollEpochRef.current += 1;
      setJobs((current) => current.filter((job) => job.id !== deleting.id));
      setDeleting(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiError ? error.message : "Could not delete the job — try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  if (fatal?.kind === "signed-out") {
    return (
      <Card className="max-w-lg">
        <h2 className="text-base font-semibold text-ink">Your session expired</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Sign in to keep viewing and managing your jobs. No jobs are lost
          while you are away.
        </p>
        <ButtonLink
          href={`/auth/signin?callbackUrl=${encodeURIComponent("/app/jobs")}`}
          variant="secondary"
          size="sm"
          className="mt-4"
        >
          Sign in again
        </ButtonLink>
      </Card>
    );
  }

  if (fatal?.kind === "load-error") {
    return (
      <Card role="alert" className="max-w-lg">
        <h2 className="text-base font-semibold text-err">
          Could not load your jobs
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {fatal.message}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh(true)}>
            Try again
          </Button>
          <ButtonLink href="/app/new" variant="ghost" size="sm">
            New analysis
          </ButtonLink>
        </div>
      </Card>
    );
  }

  if (jobs.length === 0 && !hasFilters) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-14 text-center">
        <h2 className="text-base font-semibold text-ink">No jobs yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          Upload a video, audio file, image set, PDF, or public URL and
          OpenContext will turn it into structured developer context for
          text-only AI agents.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/app/new" size="md">
            Start your first analysis
          </ButtonLink>
          <ButtonLink href="/demo" variant="ghost" size="md">
            See the demo instead
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="search"
        aria-label="Filter jobs"
        aria-busy={filtering}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search jobs by name…"
          aria-label="Search jobs"
          className="min-w-48 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
        />
        {workspaces.length > 0 && (
          <select
            value={workspaceFilter}
            onChange={(event) => setWorkspaceFilter(event.target.value)}
            aria-label="Scope filter"
            className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="">All scopes</option>
            <option value="personal">Personal only</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                Team: {workspace.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Status filter"
          className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="PARTIAL">Partial</option>
          <option value="FAILED">Failed</option>
        </select>
        <select
          value={sourceKindFilter}
          onChange={(event) => setSourceKindFilter(event.target.value)}
          aria-label="Format filter"
          className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">All formats</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="image">Image</option>
          <option value="pdf">PDF</option>
        </select>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {reconnecting && hasActive && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-ink-muted"
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-warn stage-running"
          />
          Reconnecting…
        </p>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-10 text-center">
          <h2 className="text-base font-semibold text-ink">No matching jobs</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            No jobs match the current search or filter settings.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Your jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard
                job={job}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleting(job);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-ink-faint">
        <p>
          {hasActive
            ? "Updating automatically while jobs are processing…"
            : "All jobs are finished — updates paused."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await refresh(true);
            setRefreshing(false);
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.displayName ?? ""}
        heading="Delete this job?"
        body="The job, its source media, and all results will be removed permanently. This cannot be undone."
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={closeDelete}
      />
    </div>
  );
}

function JobCard({
  job,
  onDelete,
}: {
  job: JobSummary;
  onDelete: () => void;
}) {
  const active = isActiveStatus(job.status);
  const failed = job.status === "FAILED";
  const partial = job.status === "PARTIAL";
  const canManage = job.canManage !== false;
  const stageLabel = active
    ? job.currentStage
      ? stageDisplayName(job.currentStage)
      : "Waiting in queue"
    : null;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 grow">
          <Link
            href={`/app/jobs/${encodeURIComponent(job.id)}`}
            className="block truncate text-sm font-semibold text-ink transition-colors hover:text-accent"
          >
            {job.displayName}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            <Badge tone="neutral" mono>
              {job.detailLevel}
            </Badge>
            {job.sourceKind && (
              <Badge tone="neutral" mono>
                {job.sourceKind.toUpperCase()}
              </Badge>
            )}
            {job.workspaceName && (
              <Badge tone="accent">{job.workspaceName}</Badge>
            )}
            {failed && job.error ? (
              <span className="min-w-0 truncate text-xs text-err">
                {job.error}
              </span>
            ) : partial && job.error ? (
              <span className="min-w-0 truncate text-xs text-ink-muted">
                {job.error}
              </span>
            ) : (
              <span className="text-xs text-ink-faint">
                Created {formatDate(job.createdAt)}
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Delete job ${job.displayName}`}
          >
            Delete
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 grow overflow-hidden rounded-full bg-panel-muted">
          <div
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.displayName} progress`}
            className={cx(
              "h-full rounded-full transition-[width] duration-300",
              failed ? "bg-err" : partial ? "bg-warn" : "bg-accent",
            )}
            style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-muted">
          {job.progress}%
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {stageLabel ?? (failed ? "Processing did not complete" : "Finished")}
        {active && " · Larger files can take a while"}
      </p>
    </Card>
  );
}
