"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { JobSummary } from "@opencontext/schemas";
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
}

type FatalState =
  | { kind: "signed-out" }
  | { kind: "load-error"; message: string };

/**
 * The signed-in user's job list (jobs.md B8/B10).
 * Polls every 3s while any job is active and stops when all are terminal
 * (B3). Transient poll failures show a non-blocking reconnect notice and
 * never change the displayed list; a 401 swaps the board for the
 * sign-in prompt (identity.md B5).
 */
export function JobsList({ initialJobs }: JobsListProps) {
  const [jobs, setJobs] = useState<JobSummary[]>(initialJobs);
  const [reconnecting, setReconnecting] = useState(false);
  const [fatal, setFatal] = useState<FatalState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<JobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasActive = jobs.some((job) => isActiveStatus(job.status));

  const refresh = useCallback(async (notify = false) => {
    try {
      const next = await fetchJobsList();
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
              : "Could not load your jobs - check your connection.",
        });
      }
    }
  }, []);

  // Poll every 3 seconds while any job is active (jobs.md B3).
  useEffect(() => {
    if (fatal || !hasActive) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        setJobs(await fetchJobsList());
        setReconnecting(false);
      } catch (error) {
        if (isSignInError(error)) {
          setFatal({ kind: "signed-out" });
          return;
        }
        // B3: the displayed list never changes because of a poll failure.
        setReconnecting(true);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [hasActive, fatal]);

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
      setJobs((current) => current.filter((job) => job.id !== deleting.id));
      setDeleting(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiError ? error.message : "Could not delete the job - try again.",
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
      <Card className="max-w-lg">
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

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-14 text-center">
        <h2 className="text-base font-semibold text-ink">No jobs yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          Upload a video or screen recording and OpenContext will turn it
          into structured developer context for text-only AI agents.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/app/new">Analyze your first video</ButtonLink>
          <ButtonLink href="/demo" variant="ghost" size="sm">
            See the demo instead
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reconnecting && hasActive && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-ink-muted"
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-(--warn) stage-running"
          />
          Reconnecting…
        </p>
      )}

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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-ink-faint">
        <p>
          {hasActive
            ? "Updating automatically while jobs are processing…"
            : "All jobs are finished - updates paused."}
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
        body="The job, its source video, and all results will be removed permanently. This cannot be undone."
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-err hover:text-err"
          aria-label={`Delete job ${job.displayName}`}
        >
          Delete
        </Button>
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
              failed ? "bg-(--err)" : partial ? "bg-(--warn)" : "bg-accent",
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
        {active && " · Large videos can take a while"}
      </p>
    </Card>
  );
}
