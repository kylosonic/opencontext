import type { ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover border border-transparent",
  secondary:
    "bg-panel text-ink border border-line hover:bg-panel-muted",
  ghost: "text-ink-muted hover:text-ink hover:bg-panel-muted border border-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

/** Shared class builder so <button> and <a> variants stay identical. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cx(
    "inline-flex items-center justify-center rounded-md font-medium",
    "transition-colors duration-150 select-none whitespace-nowrap",
    "disabled:opacity-50 disabled:pointer-events-none",
    "active:translate-y-px",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClasses(variant, size, className)}
      {...rest}
    />
  );
}

export interface ButtonLinkProps extends ComponentProps<"a"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Anchor styled as a button. External URLs (http/https) open in a new tab. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  href,
  children,
  ...rest
}: ButtonLinkProps) {
  const external = typeof href === "string" && /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      className={buttonClasses(variant, size, className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}
