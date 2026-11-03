/**
 * OpenContext mark — a restrained "vision → context" glyph:
 * an eye dot above three text lines. Rendered inline with currentColor so it
 * adapts to both color schemes without any image assets.
 */

export interface LogoMarkProps {
  className?: string;
  /** Accessible label when the mark stands alone. */
  label?: string;
}

export function LogoMark({ className, label }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
    >
      <rect width="32" height="32" rx="7" className="fill-accent" />
      <circle cx="12" cy="11.5" r="3" className="fill-on-accent" />
      <path
        d="M8.5 18.5h15M8.5 23h15M8.5 27.5h10"
        className="stroke-on-accent"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface WordmarkProps {
  className?: string;
  /** Render the mark before the wordmark text. */
  mark?: boolean;
}

export function Wordmark({ className, mark = true }: WordmarkProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {mark && <LogoMark className="size-6 shrink-0" />}
      <span className="text-[1.05rem] font-semibold tracking-tight">
        OpenContext
      </span>
    </span>
  );
}

/** Raw SVG for the favicon (inlined as a data URI in layout metadata). */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#364fc7"/>' +
  '<circle cx="12" cy="11.5" r="3" fill="#ffffff"/>' +
  '<path d="M8.5 18.5h15M8.5 23h15M8.5 27.5h10" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/></svg>';

export const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;
