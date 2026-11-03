"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface CopyButtonProps {
  /** Full text to place on the clipboard. */
  value: string;
  /** Button label; defaults to "Copy Context". */
  label?: string;
  /** Shown briefly after a successful copy. */
  copiedLabel?: string;
  className?: string;
}

/**
 * Copy Context (context-output B2).
 * Success → clipboard write, brief "Copied ✓" feedback.
 * Failure (clipboard blocked/unavailable) → fallback modal with the text
 * pre-selected in a textarea for manual copy. The text is never silently lost.
 */
export function CopyButton({
  value,
  label = "Copy Context",
  copiedLabel = "Copied ✓",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFallbackOpen(true);
    }
  };

  const closeFallback = () => {
    setFallbackOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <Button
        ref={buttonRef}
        onClick={handleCopy}
        variant="secondary"
        className={className}
        aria-live="polite"
      >
        {copied ? copiedLabel : label}
      </Button>

      {fallbackOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeFallback();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close dialog"
            onClick={closeFallback}
            className="absolute inset-0 cursor-default bg-black/60"
          />
          <Card className="relative w-full max-w-2xl" raised>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              Copy manually
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Your browser blocked clipboard access. The full context document
              is selected below — press{" "}
              <kbd className="rounded border border-line bg-panel-muted px-1.5 py-0.5 font-mono text-xs">
                Ctrl+C
              </kbd>{" "}
              (<kbd className="rounded border border-line bg-panel-muted px-1.5 py-0.5 font-mono text-xs">⌘C</kbd>{" "}
              on macOS) to copy it.
            </p>
            <textarea
              readOnly
              value={value}
              aria-label="Context document (selected for copying)"
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 h-64 w-full resize-y rounded-md border border-line bg-code-bg p-3 font-mono text-xs leading-relaxed text-ink"
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={closeFallback} variant="secondary" size="sm">
                Done
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
