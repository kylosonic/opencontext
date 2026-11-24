import { formatRange } from "../format";
import type { TranscriptSegmentView } from "../types";
import { EmptyState } from "./empty-state";

export interface TranscriptPanelProps {
  segments: TranscriptSegmentView[];
  /** False when the probed source had no audio stream. */
  audioPresent?: boolean | null;
  sourceKind?: "video" | "image" | "pdf" | "audio";
}

/** Transcript tab. Empty output distinguishes "no track" from "no speech". */
export function TranscriptPanel({
  segments,
  audioPresent,
  sourceKind,
}: TranscriptPanelProps) {
  if (segments.length === 0) {
    if (audioPresent === false) {
      return (
        <EmptyState
          title={
            sourceKind === "image"
              ? "Still image — transcription does not apply"
              : sourceKind === "pdf"
                ? "PDF source — transcription does not apply"
              : sourceKind === "audio"
                ? "Audio source — no speech detected"
              : "No audio track detected — transcription was skipped"
          }
          body={
            sourceKind === "image"
              ? "The source is an image, so there was no audio to transcribe. Its visual details are available in Visual Analysis and Agent Context."
              : sourceKind === "pdf"
                ? "The source is a PDF, so there was no audio to transcribe. Its embedded text and rendered pages are available in OCR, Visual Analysis, and Agent Context."
              : sourceKind === "audio"
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
          <span className="w-24 shrink-0 pt-0.5 font-mono text-xs text-ink-faint">
            {formatRange(segment.start, segment.end)}
          </span>
          <p className="text-sm leading-relaxed text-ink">{segment.text}</p>
        </li>
      ))}
    </ol>
  );
}
