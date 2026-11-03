import type { HTMLAttributes, ReactNode } from "react";
import { Container } from "./container";
import { cx } from "./cx";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Rendered as the section heading id (anchor target). */
  id?: string;
  /** Small monospace kicker above the title, e.g. "SECTION 03". */
  kicker?: string;
  title: string;
  /** One-sentence description under the title. */
  description?: string;
  /** Optional right-aligned accessory (badges, links). */
  accessory?: ReactNode;
  children?: ReactNode;
  /** Remove the vertical rhythm (for nested/special layouts). */
  flush?: boolean;
}

/** Consistent landing/docs section wrapper: kicker + h2 + description + body. */
export function Section({
  id,
  kicker,
  title,
  description,
  accessory,
  children,
  flush = false,
  className,
  ...rest
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cx(!flush && "py-14 sm:py-20", className)}
      {...rest}
    >
      <Container>
        <header className="max-w-3xl">
          {kicker && <p className="label-mono mb-3">{kicker}</p>}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2
              id={id ? `${id}-title` : undefined}
              className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
            >
              {title}
            </h2>
            {accessory}
          </div>
          {description && (
            <p className="mt-3 text-base leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </header>
        {children && <div className="mt-8">{children}</div>}
      </Container>
    </section>
  );
}
