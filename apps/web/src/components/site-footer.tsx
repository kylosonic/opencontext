import Link from "next/link";
import { Wordmark } from "./logo";
import { Container } from "./ui/container";

/** Minimal footer: project links + license note. No socials, no logos. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line py-10">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs space-y-3">
            <Link
              href="/"
              className="inline-block rounded-md"
              aria-label="OpenContext — home"
            >
              <Wordmark />
            </Link>
            <p className="text-sm leading-relaxed text-ink-muted">
              Turn videos and screen recordings into structured context for
              text-only AI agents.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-8 gap-y-3 text-sm"
          >
            <Link href="/docs" className="rounded-md text-ink-muted hover:text-ink">
              Docs
            </Link>
            <Link href="/demo" className="rounded-md text-ink-muted hover:text-ink">
              Demo
            </Link>
            <Link
              href="/app/new"
              className="rounded-md text-ink-muted hover:text-ink"
            >
              Open the app
            </Link>
            <a
              href="https://github.com/kylosonic/opencontext"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md text-ink-muted hover:text-ink"
            >
              GitHub
            </a>
          </nav>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>Released under the MIT License.</p>
          <p>
            OpenContext is a working preview — some features are still in
            development.
          </p>
        </div>
      </Container>
    </footer>
  );
}
