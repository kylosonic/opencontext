"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { cx } from "./ui/cx";
import { DocsSidebar } from "./docs-sidebar";

export interface DocsShellProps {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
  accessory?: ReactNode;
}

/** Two-column documentation frame with a persistent desktop sidebar. */
export function DocsShell({
  kicker,
  title,
  description,
  children,
  accessory,
}: DocsShellProps) {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="mx-auto grid w-full max-w-6xl lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="lg:border-r lg:border-line lg:px-4 lg:pt-8">
            <DocsSidebar />
          </div>
          <div className="min-w-0 px-4 pb-16 pt-8 sm:px-6 lg:px-10 lg:pt-10">
            <header className="max-w-3xl border-b border-line pb-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="label-mono">{kicker}</p>
                {accessory}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">
                {description}
              </p>
            </header>
            <div
              className={cx(
                "pt-8",
                kicker === "API reference" ? "max-w-full" : "max-w-3xl",
              )}
            >
              {children}
            </div>
            <DocsPager wide={kicker === "API reference"} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const PAGE_ORDER = [
  { href: "/docs", label: "Overview", title: "Overview" },
  { href: "/docs/quickstart", label: "Quickstart", title: "Quickstart" },
  { href: "/docs/uploads", label: "Uploading media", title: "Uploading media" },
  { href: "/docs/jobs", label: "Job lifecycle", title: "Job lifecycle" },
  {
    href: "/docs/results",
    label: "Results & evidence",
    title: "Results & evidence",
  },
  { href: "/docs/api", label: "Jobs API", title: "Jobs API" },
  { href: "/docs/api-errors", label: "Error catalog", title: "Error catalog" },
  { href: "/docs/packages", label: "CLI & packages", title: "CLI & packages" },
  {
    href: "/docs/agents",
    label: "Agent integration",
    title: "Agent integration",
  },
  {
    href: "/docs/workers",
    label: "Worker deployment",
    title: "Worker deployment",
  },
  { href: "/docs/status", label: "Status & limits", title: "Status & limits" },
  {
    href: "/docs/security",
    label: "Security & retention",
    title: "Security & retention",
  },
] as const;

function DocsPager({ wide = false }: { wide?: boolean }) {
  const pathname = usePathname();
  const index = PAGE_ORDER.findIndex((page) => page.href === pathname);
  const previous = index > 0 ? PAGE_ORDER[index - 1] : undefined;
  const next =
    index >= 0 && index < PAGE_ORDER.length - 1
      ? PAGE_ORDER[index + 1]
      : undefined;

  return (
    <nav
      aria-label="Documentation pages"
      className={cx(
        "mt-14 border-t border-line pt-6",
        wide ? "max-w-full" : "max-w-3xl",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {previous ? (
          <Link
            href={previous.href}
            className="rounded-lg border border-line p-4 transition-colors hover:bg-panel-muted"
          >
            <span className="flex items-center gap-1.5 text-xs text-ink-faint">
              <ArrowLeft aria-hidden="true" size={14} /> Previous
            </span>
            <span className="mt-1 block text-sm font-medium text-ink">
              {previous.title}
            </span>
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        {next && (
          <Link
            href={next.href}
            className={cx(
              "rounded-lg border border-line p-4 text-right transition-colors hover:bg-panel-muted",
              "sm:col-start-2",
            )}
          >
            <span className="flex items-center justify-end gap-1.5 text-xs text-ink-faint">
              Next <ArrowRight aria-hidden="true" size={14} />
            </span>
            <span className="mt-1 block text-sm font-medium text-ink">
              {next.title}
            </span>
          </Link>
        )}
      </div>
    </nav>
  );
}

export { PAGE_ORDER };
