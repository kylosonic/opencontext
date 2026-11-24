import { formatRange } from "../format";
import type { TimelineEntryView } from "../types";
import { EmptyState } from "./empty-state";

export interface TimelinePanelProps {
  entries: TimelineEntryView[];
  /** Present → entries become seek buttons (results.md B2). */
  onSeek?: (timestampSec: number) => void;
  /** True while the job is still running. */
  active?: boolean;
  sourceKind?: "video" | "image" | "pdf" | "audio";
}

/** Timeline tab: timestamped entries; clicking seeks the player. */
export function TimelinePanel({
  entries,
  onSeek,
  active = false,
  sourceKind,
}: TimelinePanelProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={active ? "No timeline entries yet" : "No timeline entries were recorded"}
        body={
          active
            ? "The timeline is assembled once extraction, transcription, and analysis have completed."
            : sourceKind === "image"
              ? "Visual analysis completed without separate timeline segments for this image."
              : sourceKind === "pdf"
                ? "Document analysis completed without separate timeline segments for this PDF."
                : sourceKind === "audio"
                  ? "Audio analysis completed without separate timeline segments."
                  : "Analysis completed without separate timeline segments."
        }
      />
    );
  }

  return (
    <ol className="space-y-1.5">
      {entries.map((entry, index) => {
        const content = (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs text-ink-faint">
                {formatRange(entry.start, entry.end)}
              </span>
              {entry.title && (
                <h3 className="text-sm font-semibold text-ink">
                  {entry.title}
                </h3>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {entry.summary}
            </p>
          </>
        );

        const sharedClass =
          "block w-full rounded-lg border border-line bg-panel p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

        return (
          <li key={index}>
            {onSeek ? (
              <button
                type="button"
                onClick={() => onSeek(entry.start)}
                aria-label={`Seek to ${formatRange(entry.start, entry.end)}${
                  entry.title ? `: ${entry.title}` : ""
                }`}
                className={`${sharedClass} hover:bg-panel-muted`}
              >
                {content}
              </button>
            ) : (
              <div className={sharedClass}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
