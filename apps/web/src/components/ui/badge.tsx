import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-panel-muted text-ink-muted border-line",
  accent: "bg-accent text-on-accent border-transparent",
  success: "bg-ok-bg text-ok border-transparent",
  warning: "bg-warn-bg text-warn border-transparent",
  danger: "bg-err-bg text-err border-transparent",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

/** Small inline label. Use `mono` for technical chips (detail levels, etc.). */
export function Badge({
  tone = "neutral",
  mono = false,
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5",
        "text-xs font-medium leading-5",
        mono && "font-mono uppercase tracking-wide text-[0.68rem]",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
