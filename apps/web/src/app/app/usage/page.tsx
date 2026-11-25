import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UsageDashboard } from "@/components/app/usage-dashboard";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { usageSummaryForUser } from "@/server/billing/usage";
import { listWorkspaces } from "@/server/workspaces";

export const metadata: Metadata = {
  title: "Usage — OpenContext",
  description:
    "View completed media analysis volume, detail-level mix, and recorded usage costs across personal and team jobs.",
};

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/app/usage")}`);
  }
  const [summary, workspaces] = await Promise.all([
    usageSummaryForUser(session.user.id, { days: 30 }),
    listWorkspaces(session.user.id),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-mono">Account &amp; Teams</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  Usage summary
                </h1>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
                  Track completed analyses, processed media duration, format
                  mix, and recorded unit-cost events across your personal and
                  team workspaces.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/app/jobs" variant="ghost" size="sm">
                  Your jobs
                </ButtonLink>
                <ButtonLink href="/app/teams" variant="ghost" size="sm">
                  Teams
                </ButtonLink>
                <ButtonLink href="/app/new" size="sm">
                  New analysis
                </ButtonLink>
              </div>
            </div>

            {summary && (
              <UsageDashboard
                initialSummary={summary}
                workspaces={workspaces}
              />
            )}

            <div className="mt-10 flex items-center justify-between border-t border-line pt-4">
              <p className="text-xs text-ink-faint">
                Completed jobs are kept for 14 days; unfinished jobs for 7.
              </p>
              <Link
                href="/auth/signout"
                className="text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                Sign out
              </Link>
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
