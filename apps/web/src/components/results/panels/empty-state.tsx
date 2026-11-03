import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
}

/** Shared no-content notice (results.md B4: no stage renders a blank tab). */
export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>}
    </div>
  );
}
