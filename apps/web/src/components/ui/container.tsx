import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** Horizontal page container with consistent gutters. */
export function Container({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
      {...rest}
    />
  );
}
