"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./logo";
import { ButtonLink } from "./ui/button";
import { Container } from "./ui/container";
import { cx } from "./ui/cx";

const PUBLIC_LINKS = [
  { href: "/docs", label: "Docs", matchPrefix: "/docs" },
  { href: "/demo", label: "Demo", matchPrefix: "/demo" },
];

const APP_LINKS = [
  { href: "/app/jobs", label: "Jobs", matchPrefix: "/app/jobs" },
  { href: "/app/teams", label: "Teams", matchPrefix: "/app/teams" },
  { href: "/app/usage", label: "Usage", matchPrefix: "/app/usage" },
];

/**
 * Global header with links to the public docs, demo, and authenticated app.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "";
  const inApp = pathname.startsWith("/app");
  const links = inApp ? [...APP_LINKS, ...PUBLIC_LINKS] : PUBLIC_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-sm">
      <Container>
        <div className="flex h-14 items-center gap-x-2 sm:gap-x-4">
          <Link
            href="/"
            className="mr-1 rounded-md text-ink sm:mr-2"
            aria-label="OpenContext — home"
          >
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            {links.map((link) => {
              const active = pathname.startsWith(link.matchPrefix);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "rounded-md px-2 py-2 text-sm font-medium transition-colors sm:px-3",
                    active
                      ? "bg-panel-muted text-ink"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ButtonLink
              href="/app/new"
              variant={inApp ? "primary" : "secondary"}
              size="sm"
              aria-label={inApp ? "New analysis" : "Open the app"}
            >
              <span className="hidden sm:inline">
                {inApp ? "New analysis" : "Open the app"}
              </span>
              <span className="sm:hidden">{inApp ? "New" : "Open"}</span>
            </ButtonLink>
          </div>
        </div>
      </Container>
    </header>
  );
}
