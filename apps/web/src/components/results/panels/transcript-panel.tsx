import { formatRange } from "../format";
import type { TranscriptSegmentView } from "../types";
import { EmptyState } from "./empty-state";

export interface TranscriptPanelProps {
  segments: TranscriptSegmentView[];
}

/** Transcript tab. Empty (no audio track) → the results.md B4 notice. */
export function TranscriptPanel({ segments }: TranscriptPanelProps) {
  if (segments.length === 0) {
    return (
      <EmptyState
        title="No audio track detected — transcription was skipped"
        body="The source video has no audio track, so there was nothing to transcribe. This is not an error."
      />
    );
  }

  return (
    <ol className="divide-y divide-line">
      {segments.map((segment, index) => (
        <li key={index} className="flex gap-4 py-3">
          <span className="w-24 shrink-0 pt-0.5 font-mono text-xs text-ink-faint">
            {formatRange(segment.start, segment.end)}
          </span>
          <p className="text-sm leading-relaxed text-ink">{segment.text}</p>
        </li>
      ))}
    </ol>
  );
}
