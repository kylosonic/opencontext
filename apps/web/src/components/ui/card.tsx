import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds standard inner padding. Set false for custom-padded cards. */
  padded?: boolean;
  /** Slightly raised surface (used inside other cards). */
  raised?: boolean;
}

/** Surface container: panel background, hairline border, rounded corners. */
export function Card({
  padded = true,
  raised = false,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        "rounded-lg border border-line",
        raised ? "bg-panel-raised" : "bg-panel",
        padded && "p-5 sm:p-6",
        className,
      )}
      {...rest}
    />
  );
}
