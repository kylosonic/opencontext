import { formatRange } from "../format";
import type { TranscriptSegmentView } from "../types";
import { EmptyState } from "./empty-state";

export interface TranscriptPanelProps {
  segments: TranscriptSegmentView[];
  /** False when the probed source had no audio stream. */
  audioPresent?: boolean | null;
}

/** Transcript tab. Empty output distinguishes "no track" from "no speech". */
export function TranscriptPanel({ segments, audioPresent }: TranscriptPanelProps) {
  if (segments.length === 0) {
    if (audioPresent === false) {
      return (
        <EmptyState
          title="No audio track detected — transcription was skipped"
          body="The source video has no audio track, so there was nothing to transcribe. This is not an error."
        />
      );
    }
    return (
      <EmptyState
        title="Audio track contained no speech"
        body="The audio track was analyzed, but no speech was detected. This is not an error."
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
