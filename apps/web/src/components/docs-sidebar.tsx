"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui/cx";

const NAV_GROUPS = [
  {
    label: "Get started",
    links: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    label: "Build with OpenContext",
    links: [
      { href: "/docs/api", label: "Jobs API" },
      { href: "/docs/packages", label: "CLI & packages" },
      { href: "/docs/agents", label: "Agent integration" },
    ],
  },
  {
    label: "Operate",
    links: [
      { href: "/docs/workers", label: "Worker deployment" },
      { href: "/docs/status", label: "Status & limits" },
      { href: "/docs/api-errors", label: "Error catalog" },
    ],
  },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="label-mono mb-2">{group.label}</p>
          <ul className="space-y-0.5">
            {group.links.map((link) => {
              const current = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "block rounded-md px-3 py-2 text-sm transition-colors",
                      current
                        ? "bg-panel-muted font-medium text-ink"
                        : "text-ink-muted hover:bg-panel-muted hover:text-ink",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Responsive documentation navigation shared by every reference page. */
export function DocsSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="border-b border-line lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-ink">Documentation</span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="docs-mobile-nav"
            aria-label={open ? "Close documentation navigation" : "Open documentation navigation"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink-muted hover:bg-panel-muted hover:text-ink"
          >
            {open ? <X aria-hidden="true" size={17} /> : <Menu aria-hidden="true" size={17} />}
          </button>
        </div>
        {open && (
          <div id="docs-mobile-nav" className="px-4 pb-5">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
      <aside className="hidden lg:block">
        <div className="sticky top-20 pb-8">
          <NavLinks />
          <Link
            href="/demo"
            className="mt-8 block rounded-md border border-line px-3 py-2 text-sm text-ink-muted hover:bg-panel-muted hover:text-ink"
          >
            Try the interactive demo
          </Link>
        </div>
      </aside>
    </>
  );
}
