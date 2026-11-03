import { formatRange } from "../format";
import type { TimelineEntryView } from "../types";
import { EmptyState } from "./empty-state";

export interface TimelinePanelProps {
  entries: TimelineEntryView[];
  /** Present → entries become seek buttons (results.md B2). */
  onSeek?: (timestampSec: number) => void;
}

/** Timeline tab: timestamped entries; clicking seeks the player. */
export function TimelinePanel({ entries, onSeek }: TimelinePanelProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No timeline entries yet"
        body="The timeline is assembled once extraction, transcription, and analysis have completed."
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
          "block w-full rounded-lg border border-line bg-panel p-4 text-left transition-colors";

        return (
          <li key={index}>
            {onSeek ? (
              <button
                type="button"
                onClick={() => onSeek(entry.start)}
                aria-label={`Seek to ${formatRange(entry.start, entry.end)}`}
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
