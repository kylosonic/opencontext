import type { HTMLAttributes } from "react";
import { cx } from "./ui/cx";

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  code: string;
  /** Accessible label for the code region. */
  label?: string;
  /** Wraps long lines instead of scrolling horizontally. */
  wrap?: boolean;
}

/** Styled terminal-style block for code samples and the context document. */
export function CodeBlock({
  code,
  label,
  wrap = false,
  className,
  ...rest
}: CodeBlockProps) {
  return (
    <pre
      aria-label={label}
      className={cx(
        "overflow-auto rounded-lg border border-line bg-code-bg p-4",
        "font-mono text-[0.82rem] leading-relaxed text-ink",
        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        className,
      )}
      {...rest}
    >
      {code}
    </pre>
  );
}
