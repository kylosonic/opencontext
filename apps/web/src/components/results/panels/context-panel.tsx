import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";

export interface ContextPanelProps {
  markdown: string;
  demo?: boolean;
  onSeek?: (timestampSec: number) => void;
}

const CONTEXT_REFERENCE =
  /\[(E\d{4,}) · (\d{2,}:\d{2}) · (Observed|Inferred|Uncertain)\]|(`?)\[(\d{2,}:\d{2})(-|–)(\d{2,}:\d{2})\]\4/g;

function renderEvidenceMarkers(
  markdown: string,
  onSeek?: (timestampSec: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  let key = 0;

  for (const match of markdown.matchAll(CONTEXT_REFERENCE)) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push(markdown.slice(offset, index));

    const marker = match[0];
    const id = match[1];
    const timestamp = match[2];
    const certainty = match[3];
    const rangeStart = match[5];
    const rangeSeparator = match[6];
    const rangeEnd = match[7];
    if (!onSeek) {
      nodes.push(marker);
    } else if (id && timestamp && certainty) {
      const [minutes, seconds] = timestamp.split(":").map(Number);
      nodes.push(
        <button
          key={`evidence-${key++}`}
          type="button"
          title={`Jump to ${timestamp} in the source video (${certainty.toLowerCase()})`}
          aria-label={`Jump to evidence ${id} at ${timestamp}, ${certainty.toLowerCase()}`}
          onClick={() => onSeek(minutes * 60 + seconds)}
          className="mx-1 inline-flex rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 align-baseline font-sans text-[0.7rem] text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {id} · {timestamp} · {certainty}
        </button>,
      );
    } else {
      const [minutes, seconds] = (rangeStart ?? "00:00").split(":").map(Number);
      nodes.push(
        <button
          key={`range-${key++}`}
          type="button"
          title={`Jump to ${rangeStart}–${rangeEnd} in the source video`}
          aria-label={`Seek to source range ${rangeStart} through ${rangeEnd}`}
          onClick={() => onSeek(minutes * 60 + seconds)}
          className="rounded bg-accent/10 px-1 font-mono text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          [{rangeStart}{rangeSeparator}{rangeEnd}]
        </button>,
      );
    }
    offset = index + marker.length;
  }

  if (offset < markdown.length) nodes.push(markdown.slice(offset));
  return nodes;
}

/**
 * Agent Context tab — the primary output. The full Markdown document renders
 * as monospace text (no external markdown renderer): it is what gets copied
 * and downloaded verbatim.
 */
export function ContextPanel({ markdown, demo = false, onSeek }: ContextPanelProps) {
  if (!markdown) {
    return (
      <EmptyState
        title="Context is still being generated"
        body="The developer context document is produced in the final processing stage."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-muted">
        The complete document below is what{" "}
        <span className="font-medium text-ink">Copy Context</span> places on
        your clipboard and what{" "}
        <span className="font-medium text-ink">Download Markdown</span> saves.
        {onSeek && " Citations and timeline ranges select their source time; live jobs seek the video when playback is available."}
        {demo && " The header carries the Demo Analysis marker, as will every export from this demo."}
      </p>
      <pre
        aria-label="Developer context document (Markdown)"
        className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-code-bg p-4 font-mono text-[0.8rem] leading-relaxed text-ink whitespace-pre-wrap break-words"
      >
        {renderEvidenceMarkers(markdown, onSeek)}
      </pre>
    </div>
  );
}
