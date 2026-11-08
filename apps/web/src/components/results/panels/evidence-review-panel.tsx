"use client";

import { useState } from "react";
import type { EvidenceRecord } from "@opencontext/schemas";
import { ApiError, patchEvidenceReviewRequest } from "@/components/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatClock } from "../format";
import { EmptyState } from "./empty-state";

type ReviewFilter = "NEEDS_REVIEW" | "ALL" | "FLAGGED";

export interface EvidenceReviewPanelProps {
  jobId: string;
  evidence: EvidenceRecord[];
  demo?: boolean;
  onSeek?: (timestampSec: number) => void;
  onSaved: (result: { markdown: string; json: unknown }) => void;
}

/** Human review annotations stay alongside, rather than replacing, model claims. */
export function EvidenceReviewPanel({
  jobId,
  evidence,
  demo = false,
  onSeek,
  onSaved,
}: EvidenceReviewPanelProps) {
  const [filter, setFilter] = useState<ReviewFilter>("NEEDS_REVIEW");
  const [visibleLimit, setVisibleLimit] = useState(40);

  if (evidence.length === 0) {
    return (
      <EmptyState
        title="No evidence to review"
        body="This result does not contain an evidence ledger."
      />
    );
  }

  const reviewedCount = evidence.filter((item) => item.review).length;
  const flaggedCount = evidence.filter(
    (item) => item.review?.status === "FLAGGED",
  ).length;
  const filtered = evidence.filter((item) => {
    if (filter === "NEEDS_REVIEW") return !item.review;
    if (filter === "FLAGGED") return item.review?.status === "FLAGGED";
    return true;
  });
  const visible = filtered.slice(0, visibleLimit);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Evidence review</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Check extracted claims against the source. Reviews and suggested
          corrections are saved alongside the original claim and included in
          Markdown and JSON exports.
        </p>
        {demo && (
          <p className="mt-2 text-xs text-ink-faint">
            Demo evidence is read-only. Review an uploaded job to save annotations.
          </p>
        )}
      </div>

      <div
        role="group"
        aria-label="Evidence review filters"
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          size="sm"
          variant={filter === "NEEDS_REVIEW" ? "secondary" : "ghost"}
          onClick={() => {
            setFilter("NEEDS_REVIEW");
            setVisibleLimit(40);
          }}
        >
          Needs review ({evidence.length - reviewedCount})
        </Button>
        <Button
          size="sm"
          variant={filter === "FLAGGED" ? "secondary" : "ghost"}
          onClick={() => {
            setFilter("FLAGGED");
            setVisibleLimit(40);
          }}
        >
          Flagged ({flaggedCount})
        </Button>
        <Button
          size="sm"
          variant={filter === "ALL" ? "secondary" : "ghost"}
          onClick={() => {
            setFilter("ALL");
            setVisibleLimit(40);
          }}
        >
          All ({evidence.length})
        </Button>
        <span className="ml-auto text-xs text-ink-faint">
          {reviewedCount} of {evidence.length} reviewed
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel-muted/50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink">
            {filter === "NEEDS_REVIEW"
              ? "All evidence claims have been reviewed."
              : "No flagged claims."}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            You can still view every claim using the All filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <EvidenceReviewItem
              key={item.id}
              jobId={jobId}
              evidence={item}
              demo={demo}
              onSeek={onSeek}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}

      {visible.length < filtered.length && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisibleLimit((current) => current + 40)}
        >
          Show more ({filtered.length - visible.length} remaining)
        </Button>
      )}
    </div>
  );
}

function EvidenceReviewItem({
  jobId,
  evidence,
  demo,
  onSeek,
  onSaved,
}: {
  jobId: string;
  evidence: EvidenceRecord;
  demo: boolean;
  onSeek?: (timestampSec: number) => void;
  onSaved: (result: { markdown: string; json: unknown }) => void;
}) {
  const [note, setNote] = useState(evidence.review?.note ?? "");
  const [correctedText, setCorrectedText] = useState(
    evidence.review?.correctedText ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (status: "CONFIRMED" | "FLAGGED" | "UNREVIEWED") => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await patchEvidenceReviewRequest(jobId, evidence.id, {
        status,
        ...(status !== "UNREVIEWED" && note.trim()
          ? { note: note.trim() }
          : {}),
        ...(status === "FLAGGED" && correctedText.trim()
          ? { correctedText: correctedText.trim() }
          : {}),
      });
      onSaved(result);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save this review. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const status = evidence.review?.status;
  const reviewLabel =
    status === "CONFIRMED"
      ? "human confirmed"
      : status === "FLAGGED"
        ? "flagged"
        : "unreviewed";
  const labelId = `evidence-${evidence.id}-summary`;
  return (
    <article aria-labelledby={labelId} className="rounded-lg border border-line bg-panel p-4">
      <span id={labelId} className="sr-only">
        Evidence {evidence.id}, {evidence.kind.toLowerCase()}, {evidence.certainty.toLowerCase()},
        timestamp {formatClock(evidence.timestampSec)}, {reviewLabel}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">
          E{String(evidence.id).padStart(4, "0")}
        </span>
        <Badge mono>{evidence.kind}</Badge>
        <Badge
          tone={
            evidence.certainty === "OBSERVED"
              ? "success"
              : evidence.certainty === "INFERRED"
                ? "accent"
                : "warning"
          }
          mono
        >
          {evidence.certainty}
        </Badge>
        {status && (
          <Badge tone={status === "CONFIRMED" ? "success" : "danger"}>
            {status === "CONFIRMED" ? "Human confirmed" : "Flagged"}
          </Badge>
        )}
        {onSeek ? (
          <button
            type="button"
            className="ml-auto rounded-sm font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => onSeek(evidence.timestampSec)}
            aria-label={`Jump to evidence ${evidence.id} at ${formatClock(evidence.timestampSec)}, ${reviewLabel}`}
          >
            {formatClock(evidence.timestampSec)} ↗
          </button>
        ) : (
          <span className="ml-auto font-mono text-xs text-ink-faint">
            {formatClock(evidence.timestampSec)}
          </span>
        )}
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {evidence.text}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium text-ink-muted">
          Reviewer note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={demo || busy}
            maxLength={1000}
            rows={2}
            placeholder="What did you observe at this point?"
            className="w-full resize-y rounded-md border border-line bg-panel px-3 py-2 text-sm font-normal text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-ink-muted">
          Suggested correction (saved when flagged)
          <span className="font-normal text-ink-faint">
            Add a correction, then use Flag claim to preserve it with the review.
          </span>
          <textarea
            value={correctedText}
            onChange={(event) => setCorrectedText(event.target.value)}
            disabled={demo || busy}
            maxLength={5000}
            rows={2}
            placeholder="Leave blank if the original claim is accurate"
            className="w-full resize-y rounded-md border border-line bg-panel px-3 py-2 text-sm font-normal text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          />
        </label>
      </div>

      {!demo && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void save("CONFIRMED")}
            disabled={busy || Boolean(correctedText.trim())}
            title={
              correctedText.trim()
                ? "Clear the correction or flag this claim"
                : undefined
            }
          >
            {busy ? "Saving…" : "Confirm claim"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void save("FLAGGED")}
            disabled={busy}
          >
            Flag claim
          </Button>
          {status && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void save("UNREVIEWED")}
              disabled={busy}
            >
              Clear review
            </Button>
          )}
          {saved && (
            <span role="status" className="text-xs text-ok">
              Review saved
            </span>
          )}
          {error && (
            <span role="alert" className="text-xs text-err">
              {error}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
