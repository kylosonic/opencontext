"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface ConfirmDialogProps {
  open: boolean;
  /** The thing being destroyed (e.g. the job display name). */
  title: string;
  /** Heading of the dialog. */
  heading?: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible destructive-action confirmation (jobs.md B10: dialog naming
 * the job and stating the action cannot be undone). Escape/backdrop/
 * Cancel leave everything unchanged; focus returns to the opener.
 */
export function ConfirmDialog({
  open,
  title,
  heading = "Delete this job?",
  body,
  confirmLabel = "Delete job",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember the opener on first open only; re-renders while the dialog
    // is open (busy flips) must not capture the dialog's own focus.
    if (!dialogRef.current?.contains(document.activeElement)) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  useEffect(() => {
    if (!open) {
      openerRef.current?.focus();
      openerRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Cancel and close dialog"
        onClick={() => {
          if (!busy) onCancel();
        }}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div ref={dialogRef} className="relative w-full max-w-md">
        <Card raised>
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {heading}
          </h2>
          <p className="mt-2 text-sm font-medium text-ink">
            <span className="break-words">{title}</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-err">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              ref={cancelRef}
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-md bg-(--err) px-3 text-sm font-medium text-(--canvas) transition-colors duration-150 hover:opacity-90 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
