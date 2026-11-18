import Link from "next/link";
import { Wordmark } from "./logo";
import { ButtonLink } from "./ui/button";
import { Container } from "./ui/container";

const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/demo", label: "Demo" },
];

/**
 * Global header with links to the public docs, demo, and authenticated app.
 */
export function SiteHeader() {
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
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink sm:px-3"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ButtonLink href="/app/new" variant="secondary" size="sm" aria-label="Open the app">
              <span className="hidden sm:inline">Open the app</span>
              <span className="sm:hidden">Open</span>
            </ButtonLink>
          </div>
        </div>
      </Container>
    </header>
  );
}
