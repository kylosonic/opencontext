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
  /** A real `<video>` element. Rendered as-is when provided. */
  videoSlot?: ReactNode;
  className?: string;
}

/**
 * Video player area (results.md B2).
 *
 * Job pages pass a real `<video>` via `videoSlot` and wire context citations
 * and timeline clicks through the viewer's `onSeek`. Demo mode renders a
 * labeled placeholder; it never hotlinks unrelated media.
 */
export function VideoArea({
  sourceName,
  demo = false,
  selectedTimestamp = null,
  videoSlot,
  className,
}: VideoAreaProps) {
  if (videoSlot) {
    return (
      <div
        id="source-video"
        role="region"
        aria-label="Source video"
        className={cx("overflow-hidden rounded-lg border border-line", className)}
      >
        {videoSlot}
      </div>
    );
  }

  return (
    <div
      id="source-video"
      role="region"
      aria-label="Source video"
      className={cx(
        "bg-grid relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-line bg-code-bg",
        className,
      )}
    >
      <div className="mx-4 flex max-w-md flex-col items-center gap-3 text-center">
        <span className="label-mono">Sample video preview</span>
        <p className="text-sm font-medium text-ink">
          {sourceName ?? "Source video"}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {demo
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
