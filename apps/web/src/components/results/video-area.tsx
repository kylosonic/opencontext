import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { formatClock } from "./format";

export interface VideoAreaProps {
  /** Source file name shown in the placeholder. */
  sourceName?: string;
  demo?: boolean;
  /** Echoed in the placeholder when a timeline entry was clicked. */
  selectedTimestamp?: number | null;
  sourceKind?: "video" | "image" | "pdf" | "audio";
  /** A real `<video>` or `<img>` element. Rendered as-is when provided. */
  sourceSlot?: ReactNode;
  className?: string;
}

/**
 * Video player area (results.md B2).
 *
 * Job pages pass a real `<video>` or `<img>` via `sourceSlot` and wire
 * context citations and timeline clicks through the viewer's `onSeek`.
 * Demo mode renders a labeled placeholder; it never hotlinks unrelated media.
 */
export function VideoArea({
  sourceName,
  demo = false,
  selectedTimestamp = null,
  sourceKind = "video",
  sourceSlot,
  className,
}: VideoAreaProps) {
  if (sourceSlot) {
    return (
      <div
        id="source-video"
        role="region"
        aria-label={
          sourceKind === "image"
            ? "Source image"
            : sourceKind === "pdf"
              ? "Source PDF"
              : sourceKind === "audio"
                ? "Source audio"
              : "Source video"
        }
        className={cx("overflow-hidden rounded-lg border border-line", className)}
      >
        {sourceSlot}
      </div>
    );
  }

  return (
    <div
      id="source-video"
      role="region"
      aria-label={
        sourceKind === "image"
          ? "Source image"
          : sourceKind === "pdf"
            ? "Source PDF"
          : sourceKind === "audio"
            ? "Source audio"
            : "Source video"
      }
      className={cx(
        sourceKind === "audio"
          ? "bg-grid relative flex min-h-48 items-center justify-center overflow-hidden rounded-lg border border-line bg-code-bg py-10"
          : "bg-grid relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-line bg-code-bg",
        className,
      )}
    >
      <div className="mx-4 flex max-w-md flex-col items-center gap-3 text-center">
        <span className="label-mono">
          {sourceKind === "image"
            ? "Source image"
            : sourceKind === "pdf"
              ? "Source PDF"
              : sourceKind === "audio"
                ? demo
                  ? "Sample audio preview"
                  : "Source audio"
                : demo
                  ? "Sample video preview"
                  : "Source video"}
        </span>
        <p className="text-sm font-medium text-ink">
          {sourceName ??
            (sourceKind === "image"
              ? "Source image"
              : sourceKind === "pdf"
                ? "Source PDF"
                : sourceKind === "audio"
                  ? "Source audio"
                : "Source video")}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {sourceKind === "image" || sourceKind === "pdf"
            ? demo
              ? "The demo uses pre-authored data with a text-only sample preview."
              : `The uploaded ${sourceKind === "pdf" ? "PDF" : "image"} preview appears here once its context is ready.`
            : sourceKind === "audio"
              ? demo
                ? "The demo uses pre-authored data without external audio."
                : "The uploaded audio player appears here once its context is ready."
            : demo
            ? "The demo uses pre-authored data — no real video is played. For your own jobs, the source video player appears here."
            : "The source video player appears here once the job reaches the extraction stage. Timeline entries will seek it directly."}
        </p>
        {selectedTimestamp !== null && selectedTimestamp !== undefined && (
          <Badge tone="accent" mono>
            Selected {formatClock(selectedTimestamp)} — seeking controls the
            real player for uploaded jobs
          </Badge>
        )}
      </div>
    </div>
  );
}
