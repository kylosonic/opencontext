"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { JobDetail } from "@kylosonic/opencontext-schemas";
import { formatClock } from "@/components/results/format";
import { JobHeader } from "@/components/results/job-header";
import { ResultViewer } from "@/components/results/result-viewer";
import { StageChecklist } from "@/components/results/stage-checklist";
import type { AnalysisResultView } from "@/components/results/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  elapsedSeconds,
  isActiveStatus,
  jobHeaderView,
  POLL_INTERVAL_MS,
  stageChecklistView,
  stageDisplayName,
} from "@/server/jobs/jobViews";
import {
  ApiError,
  deleteJobRequest,
  fetchJobDetail,
  isSignInError,
  postJobRetry,
} from "./api-client";
import { ConfirmDialog } from "./confirm-dialog";
import { SourceGallery } from "./source-gallery";

/**
 * Job detail page shell (jobs.md B1-B6, B9, B10; results.md B2-B4).
 *
 * The server page pre-renders the current state (and, for terminal
 * COMPLETED/PARTIAL jobs, the composed result payload). While the job is
 * active this island polls GET /api/jobs/[id] every 3s and updates the
 * checklist in place (B2/B3). On a terminal transition it asks the
 * server to re-render (`router.refresh()`); the fresh props carry the
 * result and are adopted below.
 */

/** Rough pipeline order used to decide when a source player can appear. */
const STAGE_RANK: Record<string, number> = {
  QUEUED: 0,
  DOWNLOADING: 0,
  EXTRACTING: 1,
  TRANSCRIBING: 2,
  ANALYZING: 3,
  AGGREGATING: 4,
  GENERATING_CONTEXT: 5,
  COMPLETED: 6,
  PARTIAL: 6,
  FAILED: 6,
};

export interface JobDetailClientProps {
  /** Server-rendered full job state (GET /api/jobs/[id] shape). */
  detail: JobDetail;
  /** Composed results-shell payload; present only when terminal. */
  resultView: AnalysisResultView | null;
  /** Presigned video URL or owner-authenticated image URL. */
  sourceUrl: string | null;
  /** Honest note when the source media cannot be streamed back. */
  sourceUnavailableNote?: string | null;
}

export function JobDetailClient({
  detail: initialDetail,
  resultView: initialResultView,
  sourceUrl,
  sourceUnavailableNote = null,
}: JobDetailClientProps) {
  const router = useRouter();
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement | null>(null);
  const pollEpochRef = useRef(0);
  const [job, setJob] = useState<JobDetail>(initialDetail);
  // Constant per mount: the parent remounts this island (via `key`) when
  // a refreshed terminal payload with results arrives.
  const resultView = initialResultView;
  const [preparing, setPreparing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sourceBroken, setSourceBroken] = useState(false);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [selectedAssetIndex, setSelectedAssetIndex] = useState(0);
  const [now, setNow] = useState<number | null>(() => Date.now());

  const active = isActiveStatus(job.status);

  // A fresh elapsed clock while the job is active (render stays pure;
  // Date.now() only runs inside the interval callback).
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  // A server refresh can occasionally lose a navigation. Retry after a
  // bounded delay without tying the timer to the polling effect cleanup.
  useEffect(() => {
    if (!preparing) return;
    const timer = window.setTimeout(() => {
      setPreparing(false);
      router.refresh();
    }, POLL_INTERVAL_MS * 4);
    return () => window.clearTimeout(timer);
  }, [preparing, router]);

  // Prefer server-sent state changes while the job is active. The regular
  // three-second poll remains a transparent fallback for proxies or platforms
  // that terminate long-lived streams.
  useEffect(() => {
    if (!active || preparing || signedOut || typeof EventSource === "undefined") {
      return;
    }
    const epoch = pollEpochRef.current;
    const source = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/events`);
    let closed = false;
    const finish = () => {
      closed = true;
      source.close();
      setLiveConnected(false);
    };
    const accept = (event: MessageEvent<string>) => {
      if (closed || epoch !== pollEpochRef.current) return;
      try {
        const next = JSON.parse(event.data) as JobDetail;
        setJob(next);
        setReconnecting(false);
        if (next.status === "COMPLETED" || next.status === "PARTIAL") {
          setPreparing(true);
          router.refresh();
          finish();
        } else if (next.status === "FAILED") {
          finish();
        }
      } catch {
        finish();
      }
    };
    source.addEventListener("open", () => {
      if (!closed && epoch === pollEpochRef.current) {
        setLiveConnected(true);
        setReconnecting(false);
      }
    });
    source.addEventListener("job", accept as EventListener);
    source.addEventListener("deleted", finish);
    source.addEventListener("access-revoked", () => {
      setSignedOut(true);
      finish();
    });
    source.addEventListener("error", finish);
    return finish;
  }, [active, job.id, preparing, router, signedOut]);

  // Poll every 3s while the job is active (jobs.md B3).
  useEffect(() => {
    if (!active || preparing || signedOut || liveConnected) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      const epoch = pollEpochRef.current;
      try {
        const next = await fetchJobDetail(job.id);
        if (stopped || epoch !== pollEpochRef.current) return;
        setJob(next);
        setReconnecting(false);
        if (next.status === "COMPLETED" || next.status === "PARTIAL") {
          // Terminal transition reached mid-poll: re-render the server
          // page so the composed result payload arrives as fresh props
          // (the parent remounts this island via its key).
          setPreparing(true);
          router.refresh();
        }
      } catch (error) {
        if (stopped || epoch !== pollEpochRef.current) return;
        if (isSignInError(error)) {
          setSignedOut(true);
          return;
        }
        // B3: connection problems never change the displayed state.
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
  }, [active, liveConnected, preparing, signedOut, job.id, router]);

  const renderMode = useMemo(() => {
    if (signedOut) return "signed-out" as const;
    if (preparing) return "preparing" as const;
    if (active) return "active" as const;
    if (job.status === "FAILED") return "failed" as const;
    if ((job.status === "COMPLETED" || job.status === "PARTIAL") && resultView) {
      return "results" as const;
    }
    // Terminal but result props not here yet (rare; refresh will deliver).
    return "preparing" as const;
  }, [signedOut, preparing, active, job.status, resultView]);

  const headerView = useMemo(() => jobHeaderView(job), [job]);
  const checklist = useMemo(
    () => stageChecklistView(job.stageStates ?? []),
    [job],
  );
  const completedCount = useMemo(
    () =>
      (job.stageStates ?? []).filter(
        (state) =>
          state.status === "SUCCEEDED" || state.status === "SKIPPED",
      ).length,
    [job],
  );

  const playerRank = STAGE_RANK[job.status] ?? 0;
  const sourceVisible =
    !sourceBroken &&
    sourceUrl !== null &&
    playerRank >= STAGE_RANK.EXTRACTING &&
    job.status !== "FAILED";
  const sourceKind = job.source?.kind ?? "video";
  const sourceAssets = job.source?.assets ?? [];

  const seekTo = useCallback((timestampSec: number, sourceAssetIndex?: number) => {
    setSelectedTimestamp(timestampSec);
    if (sourceAssetIndex !== undefined) setSelectedAssetIndex(sourceAssetIndex);
    if (sourceKind !== "video" && sourceKind !== "audio") return;
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = timestampSec;
    void media.play().catch(() => undefined);
  }, [sourceKind]);

  const elapsedNow = useMemo(() => {
    if (!active) return elapsedSeconds(job);
    const start = new Date(job.createdAt).getTime();
    if (!Number.isFinite(start) || now === null) return 0;
    return Math.max(0, Math.round(((now - start) / 1000) * 10) / 10);
  }, [active, job, now]);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setActionError(null);
    try {
      const updated = await postJobRetry(job.id);
      setJob(updated);
      setPreparing(false);
      setSourceBroken(false);
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Could not retry the job - check your connection and try again.",
      );
    } finally {
      setRetrying(false);
    }
  };

  const handleDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteJobRequest(job.id);
      pollEpochRef.current += 1;
      router.push("/app/jobs");
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : "Could not delete the job - try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const failedStage = job.errorStage ? stageDisplayName(job.errorStage) : null;

  const sourceBrokenNote = sourceBroken
    ? "The source media could not be displayed - the file may use an unsupported codec, or the preview link is no longer valid. Results and exports are unaffected."
    : null;
  const unavailableNote = sourceBrokenNote ?? sourceUnavailableNote ?? null;
  const sourceSlot =
    !sourceBroken && sourceUrl !== null && sourceVisible ? (
      sourceKind === "image" ? (
        <SourceGallery
          sourceUrl={sourceUrl}
          sourceKind="image"
          displayName={job.displayName}
          assetCount={Math.max(1, sourceAssets.length)}
          selectedIndex={selectedAssetIndex}
          onSelectedIndexChange={setSelectedAssetIndex}
          onError={() => setSourceBroken(true)}
        />
      ) : sourceKind === "pdf" ? (
        <SourceGallery
          sourceUrl={sourceUrl}
          sourceKind="pdf"
          displayName={job.displayName}
          assetCount={Math.max(1, job.source?.pageCount ?? 1)}
          selectedIndex={selectedAssetIndex}
          onSelectedIndexChange={setSelectedAssetIndex}
          onError={() => setSourceBroken(true)}
        />
      ) : sourceKind === "audio" ? (
        <audio
          ref={mediaRef}
          src={sourceUrl}
          controls
          preload="metadata"
          className="w-full bg-panel p-4"
          aria-label="Source audio"
          onError={() => setSourceBroken(true)}
        />
      ) : (
        <video
          ref={mediaRef}
          src={sourceUrl}
          controls
          preload="metadata"
          className="aspect-video w-full bg-black"
          aria-label="Source video"
          onError={() => setSourceBroken(true)}
        />
      )
    ) : unavailableNote ? (
      <VideoUnavailable
        note={unavailableNote}
        selectedTimestamp={selectedTimestamp}
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      {/* Reconnect notice (jobs.md B3): status is never changed by it. */}
      {reconnecting && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-(--warn) stage-running"
          />
          Reconnecting…
        </p>
      )}

      {renderMode === "active" && (
        <>
          <JobHeader job={headerView} />
          <Card>
            <StageChecklist
              stages={checklist}
              progress={job.progress}
              elapsedSec={elapsedNow}
            />
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Larger files can take a while - this page updates automatically
              while your job is processing.
            </p>
          </Card>
          {sourceSlot && (
            <div className="overflow-hidden rounded-lg border border-line">
              {sourceSlot}
            </div>
          )}
          <ManageCard
            jobId={job.id}
            shareable={false}
            onDelete={() => setConfirmDeleteOpen(true)}
            error={actionError}
          />
        </>
      )}

      {renderMode === "preparing" && (
        <>
          <JobHeader job={headerView} />
          <Card aria-busy="true">
            <p className="text-sm font-medium text-ink">Loading results…</p>
            <div className="mt-4 space-y-3" aria-hidden="true">
              <div className="h-3 w-2/3 animate-pulse rounded bg-panel-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-panel-muted" />
              <div className="h-24 w-full animate-pulse rounded bg-panel-muted" />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Your job reached a finished state - pulling together the
              results.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => {
                setPreparing(true);
                router.refresh();
              }}
            >
              Refresh now
            </Button>
          </Card>
        </>
      )}

      {renderMode === "results" && resultView && (
        <>
          {job.status === "PARTIAL" && (
            <div
              role="status"
              className="rounded-lg border border-warn-bg bg-warn-bg/50 px-4 py-3"
            >
              <p className="text-sm font-semibold text-ink">
                {completedCount} of {job.stageStates?.length ?? 0} stages
                completed - {failedStage ?? "a stage"} failed
              </p>
              {job.error && (
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {job.error}
                </p>
              )}
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                {job.retryAllowed
                  ? "The content that completed stays viewable below. Retrying re-runs only the failed stages."
                  : "The content that completed stays viewable below. Retrying cannot help with a permanent failure."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {job.retryAllowed && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRetry()}
                    disabled={retrying}
                  >
                    {retrying ? "Retrying…" : "Retry failed stages"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="text-err hover:text-err"
                >
                  Delete job
                </Button>
                {actionError && (
                  <p role="alert" className="text-sm text-err">
                    {actionError}
                  </p>
                )}
              </div>
            </div>
          )}

          <ResultViewer
            job={headerView}
            result={resultView}
            stages={checklist}
            progress={job.progress}
            elapsedSec={elapsedNow}
            onSeek={seekTo}
            selectedTimestamp={selectedTimestamp}
            sourceSlot={sourceSlot}
          />
          <ManageCard
            jobId={job.id}
            shareable
            onDelete={() => setConfirmDeleteOpen(true)}
            error={actionError}
          />
        </>
      )}

      {renderMode === "failed" && (
        <>
          <JobHeader job={headerView} />
          <Card>
            <StageChecklist
              stages={checklist}
              progress={job.progress}
              elapsedSec={elapsedNow}
            />
          </Card>
          <div
            role="alert"
            className="rounded-lg border border-err-bg bg-err-bg/50 px-4 py-4"
          >
            <h2 className="text-base font-semibold text-err">
              This job could not complete
            </h2>
            {failedStage && (
              <p className="mt-1 text-sm font-medium text-ink">
                Failed at: {failedStage}
              </p>
            )}
            <p className="mt-1 text-sm leading-relaxed text-ink">
              {job.error ?? "No specific reason was recorded."}
            </p>
            {job.retryAllowed ? (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                The failure looks temporary - retrying the failed stages may
                succeed.
              </p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Retrying cannot help here - the problem is with the file
                itself. Delete this job and start a new analysis.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {job.retryAllowed && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleRetry()}
                  disabled={retrying}
                >
                  {retrying ? "Retrying…" : "Retry failed stages"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDeleteOpen(true)}
                className="text-err hover:text-err"
              >
                Delete job
              </Button>
              {actionError && (
                <p role="alert" className="text-sm text-err">
                  {actionError}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {renderMode === "signed-out" && (
        <Card className="max-w-lg">
          <h2 className="text-base font-semibold text-ink">
            Your session expired
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Sign in to keep watching this job. Its processing continues while
            you are away.
          </p>
          <ButtonLink
            href={`/auth/signin?callbackUrl=${encodeURIComponent(`/app/jobs/${job.id}`)}`}
            variant="secondary"
            size="sm"
            className="mt-4"
          >
            Sign in again
          </ButtonLink>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={job.displayName}
        heading="Delete this job?"
        body="The job, its source media, and all of its results will be removed permanently. This cannot be undone."
        busy={deleteBusy}
        error={deleteError}
        confirmLabel="Delete job"
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setConfirmDeleteOpen(false);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}

function ManageCard({
  jobId,
  shareable,
  onDelete,
  error,
}: {
  jobId: string;
  shareable: boolean;
  onDelete: () => void;
  error: string | null;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Manage job</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onDelete}>
          Delete job
        </Button>
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
      </div>
      {shareable && <ShareControls jobId={jobId} />}
    </Card>
  );
}

function ShareControls({ jobId }: { jobId: string }) {
  const [active, setActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return (await response.json()) as { active?: boolean; expiresAt?: string };
      })
      .then((status) => {
        if (cancelled) return;
        setActive(Boolean(status.active));
        setExpiresAt(status.expiresAt ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the public-link status.");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function createLink() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; expiresAt?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error?.message ?? "Could not create the share link.");
      }
      const absolute = new URL(payload.url, window.location.origin).href;
      setPublicUrl(absolute);
      setActive(true);
      setExpiresAt(payload.expiresAt ?? null);
      await navigator.clipboard?.writeText(absolute).catch(() => undefined);
      setMessage("Read-only link created and copied.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Could not revoke the share link.");
      setActive(false);
      setPublicUrl(null);
      setExpiresAt(null);
      setMessage("Public access revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-ink">Public share</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Anyone with the link can view the results and source media in read-only
        mode. Creating a new link revokes the previous one. Links expire after
        30 days.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void createLink()} disabled={busy}>
          {busy ? "Working…" : active ? "Rotate share link" : "Create share link"}
        </Button>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => void revokeLink()} disabled={busy}>
            Stop sharing
          </Button>
        )}
        {publicUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(publicUrl)}
          >
            Copy link
          </Button>
        )}
      </div>
      {active && expiresAt && (
        <p className="mt-2 text-xs text-ink-faint">
          Active until {new Date(expiresAt).toLocaleString()}.
        </p>
      )}
      {message && <p role="status" className="mt-2 text-xs text-ok">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
    </div>
  );
}

function VideoUnavailable({
  note,
  selectedTimestamp,
}: {
  note: string;
  selectedTimestamp: number | null;
}) {
  return (
    <div className="bg-grid flex aspect-video items-center justify-center overflow-hidden bg-code-bg">
      <div className="mx-4 max-w-md text-center">
        <span className="label-mono">Video playback unavailable</span>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {note}
        </p>
        {selectedTimestamp !== null && (
          <p className="mt-2 font-mono text-xs text-accent">
            Selected source moment: {formatClock(selectedTimestamp)}
          </p>
        )}
      </div>
    </div>
  );
}
