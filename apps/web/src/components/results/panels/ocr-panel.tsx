import { formatClock, formatConfidence } from "../format";
import type { OcrEntryView } from "../types";
import { EmptyState } from "./empty-state";

export interface OcrPanelProps {
  entries: OcrEntryView[];
}

/** OCR tab. Empty (no visible text) → the results.md B4 notice. */
export function OcrPanel({ entries }: OcrPanelProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No visible text was detected in this video"
        body="OCR runs during visual analysis; this job produced no text entries."
      />
    );
  }

  return (
    <ol className="divide-y divide-line">
      {entries.map((entry, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <span className="w-20 shrink-0 font-mono text-xs text-ink-faint">
            {formatClock(entry.timestampSec)}
          </span>
          <span className="grow break-words font-mono text-sm text-ink">
            {entry.text}
          </span>
          {entry.confidence !== undefined && (
            <span className="font-mono text-xs text-ink-faint">
              {formatConfidence(entry.confidence)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
