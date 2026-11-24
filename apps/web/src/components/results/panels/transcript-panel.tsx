import { formatRange } from "../format";
import type { TranscriptSegmentView } from "../types";
import { EmptyState } from "./empty-state";

export interface TranscriptPanelProps {
  segments: TranscriptSegmentView[];
  /** False when the probed source had no audio stream. */
  audioPresent?: boolean | null;
  sourceKind?: "video" | "image" | "pdf" | "audio";
  /** True while the job is still running. */
  active?: boolean;
  /** Present → segment timestamps become seek buttons. */
  onSeek?: (timestampSec: number) => void;
}

/** Transcript tab. Empty output distinguishes "no track" from "no speech". */
export function TranscriptPanel({
  segments,
  audioPresent,
  sourceKind,
  active = false,
  onSeek,
}: TranscriptPanelProps) {
  if (segments.length === 0) {
    if (sourceKind === "image" || sourceKind === "pdf") {
      return (
        <EmptyState
          title={
            sourceKind === "image"
              ? "Still image — transcription does not apply"
              : "PDF source — transcription does not apply"
          }
          body={
            sourceKind === "image"
              ? "The source is an image, so there was no audio to transcribe. Its visual details are available in Visual Analysis and Agent Context."
              : "The source is a PDF, so there was no audio to transcribe. Its embedded text and rendered pages are available in OCR, Visual Analysis, and Agent Context."
          }
        />
      );
    }
    if (active) {
      return (
        <EmptyState
          title="Transcribing audio…"
          body="Spoken segments appear here once transcription completes."
        />
      );
    }
    if (audioPresent === false || sourceKind === "audio") {
      return (
        <EmptyState
          title={
            sourceKind === "audio"
              ? "Audio source — no speech detected"
              : "No audio track detected — transcription was skipped"
          }
          body={
            sourceKind === "audio"
              ? "The uploaded audio was analyzed, but no speech was detected. This is not an error."
              : "The source video has no audio track, so there was nothing to transcribe. This is not an error."
          }
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
          {onSeek ? (
            <button
              type="button"
              onClick={() => onSeek(segment.start)}
              aria-label={`Jump to transcript segment at ${formatRange(segment.start, segment.end)}`}
              className="w-24 shrink-0 rounded-sm pt-0.5 text-left font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {formatRange(segment.start, segment.end)}
            </button>
          ) : (
            <span className="w-24 shrink-0 pt-0.5 font-mono text-xs text-ink-faint">
              {formatRange(segment.start, segment.end)}
            </span>
          )}
          <p className="text-sm leading-relaxed text-ink">{segment.text}</p>
        </li>
      ))}
    </ol>
  );
}
