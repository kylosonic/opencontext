import { formatClock, formatConfidence } from "../format";
import type { OcrEntryView } from "../types";
import { EmptyState } from "./empty-state";

export interface OcrPanelProps {
  entries: OcrEntryView[];
  sourceKind?: "video" | "image" | "pdf" | "audio";
}

/** OCR tab. Empty (no visible text) → the results.md B4 notice. */
export function OcrPanel({ entries, sourceKind }: OcrPanelProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={
          sourceKind === "image"
            ? "No visible text was detected in this image"
            : sourceKind === "pdf"
              ? "No visible or embedded text was detected in this PDF"
              : sourceKind === "audio"
                ? "OCR does not apply to an audio-only source"
              : "No visible text was detected in this video"
        }
        body={
          sourceKind === "image"
            ? "Visual analysis produced no text entries for the image."
            : sourceKind === "pdf"
              ? "PDF text extraction and visual analysis produced no text entries."
              : sourceKind === "audio"
                ? "Speech is available in the Transcript tab; audio has no visual text to recognize."
              : "OCR runs during visual analysis; this job produced no text entries."
        }
      />
    );
  }

  return (
    <ol className="divide-y divide-line">
      {entries.map((entry, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <span className="w-20 shrink-0 font-mono text-xs text-ink-faint">
            {entry.frameId ?? formatClock(entry.timestampSec)}
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
