"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { DetailLevel, JobDetail } from "@kylosonic/opencontext-schemas";
import { formatClock } from "@/components/results/format";
import { JobHeader } from "@/components/results/job-header";
import { ResultViewer } from "@/components/results/result-viewer";
import { StageChecklist } from "@/components/results/stage-checklist";
import type { AnalysisResultView } from "@/components/results/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  elapsedSeconds,
  jobHeaderView,
  stageChecklistView,
  stageDisplayName,
} from "@/server/jobs/jobViews";
import {
  ApiError,
  deleteJobRequest,
  patchJobRename,
  postJobRerun,
  postJobRetry,
} from "./api-client";
import { ConfirmDialog } from "./confirm-dialog";
import { ManageCard } from "./job-share-controls";
import { SourceGallery } from "./source-gallery";
import { useJobLiveUpdates } from "./use-job-live-updates";

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
  /** Whether the caller can delete, retry, share, and review this job. */
  canManage?: boolean;
}

export function JobDetailClient({
  detail: initialDetail,
  resultView: initialResultView,
  sourceUrl,
  sourceUnavailableNote = null,
  canManage,
}: JobDetailClientProps) {
  const router = useRouter();
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement | null>(null);
  // Constant per mount: the parent remounts this island (via `key`) when
  // a refreshed terminal payload with results arrives.
  const resultView = initialResultView;
  const userCanManage = canManage ?? initialDetail.canManage ?? true;
  const {
    job,
    setJob,
    active,
    preparing,
    setPreparing,
    signedOut,
    reconnecting,
    now,
    pollEpochRef,
  } = useJobLiveUpdates({ initialDetail, router });
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sourceBroken, setSourceBroken] = useState(false);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [selectedAssetIndex, setSelectedAssetIndex] = useState(0);

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
  const downloadOriginalUrl = job.source?.key
    ? `/api/jobs/${encodeURIComponent(job.id)}/source?download=1${sourceAssets.length > 1 ? `&asset=${selectedAssetIndex}` : ""}`
    : null;

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
          : "Could not retry the job — check your connection and try again.",
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
          : "Could not delete the job — try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRename = async (nextName: string) => {
    const updated = await patchJobRename(job.id, nextName);
    setJob(updated);
  };

  const handleRerun = async (detailLevel: DetailLevel) => {
    const created = await postJobRerun(job.id, detailLevel);
    router.push(`/app/jobs/${encodeURIComponent(created.id)}`);
  };

  const failedStage = job.errorStage ? stageDisplayName(job.errorStage) : null;

  const sourceBrokenNote = sourceBroken
    ? "The source media could not be displayed — the file may use an unsupported codec, or the preview link is no longer valid. Results and exports are unaffected."
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
      <SourceUnavailable
        sourceKind={sourceKind}
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
            className="size-1.5 rounded-full bg-warn stage-running"
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
              Larger files can take a while — this page updates automatically
              while your job is processing.
            </p>
          </Card>
          {sourceSlot && (
            <div className="overflow-hidden rounded-lg border border-line">
              {sourceSlot}
            </div>
          )}
          {userCanManage && (
            <ManageCard
              jobId={job.id}
              shareable={false}
              onDelete={() => setConfirmDeleteOpen(true)}
            />
          )}
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
              Your job reached a finished state — pulling together the
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
                completed — {failedStage ?? "a stage"} failed
              </p>
              {job.error && (
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {job.error}
                </p>
              )}
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                {job.retryAllowed
                  ? userCanManage
                    ? "The content that completed stays viewable below. Retrying re-runs only the failed stages."
                    : "The content that completed stays viewable below. A team owner or admin can retry the failed stages."
                  : "The content that completed stays viewable below. Retrying cannot help with a permanent failure."}
              </p>
              {userCanManage && (job.retryAllowed || actionError) && (
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
                  {actionError && (
                    <p role="alert" className="text-sm text-err">
                      {actionError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <ResultViewer
            job={headerView}
            result={resultView}
            stages={checklist}
            progress={job.progress}
            elapsedSec={elapsedNow}
            reviewReadOnly={!userCanManage}
            onSeek={seekTo}
            selectedTimestamp={selectedTimestamp}
            sourceSlot={sourceSlot}
          />
          {downloadOriginalUrl && (
            <div className="flex justify-end">
              <a
                href={downloadOriginalUrl}
                download
                className="inline-flex h-8 items-center rounded-md border border-line bg-panel px-3 text-xs font-medium text-ink transition-colors hover:bg-panel-muted"
              >
                Download original
              </a>
            </div>
          )}
          {userCanManage && (
            <ManageCard
              jobId={job.id}
              shareable
              displayName={job.displayName}
              onRename={handleRename}
              detailLevel={job.detailLevel}
              onRerun={handleRerun}
              onDelete={() => setConfirmDeleteOpen(true)}
            />
          )}
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
                The failure looks temporary — retrying the failed stages may
                succeed.
              </p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Retrying cannot help here — the problem is with the file
                itself.{" "}
                {userCanManage
                  ? "Delete this job and start a new analysis."
                  : "Contact a team owner or admin to delete this job."}
              </p>
            )}
            {userCanManage && (
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
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  Delete job
                </Button>
                {actionError && (
                  <p role="alert" className="text-sm text-err">
                    {actionError}
                  </p>
                )}
              </div>
            )}
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

function SourceUnavailable({
  sourceKind,
  note,
  selectedTimestamp,
}: {
  sourceKind: "video" | "image" | "pdf" | "audio";
  note: string;
  selectedTimestamp: number | null;
}) {
  const heading =
    sourceKind === "audio"
      ? "Audio playback unavailable"
      : sourceKind === "image"
        ? "Image preview unavailable"
        : sourceKind === "pdf"
          ? "PDF preview unavailable"
          : "Video playback unavailable";
  return (
    <div
      className={
        sourceKind === "audio"
          ? "bg-grid flex items-center justify-center overflow-hidden bg-code-bg py-10"
          : "bg-grid flex aspect-video items-center justify-center overflow-hidden bg-code-bg"
      }
    >
      <div className="mx-4 max-w-md text-center">
        <span className="label-mono">{heading}</span>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {note}
        </p>
        {selectedTimestamp !== null &&
          (sourceKind === "video" || sourceKind === "audio") && (
            <p className="mt-2 font-mono text-xs text-accent">
              Selected source moment: {formatClock(selectedTimestamp)}
            </p>
          )}
      </div>
    </div>
  );
}
