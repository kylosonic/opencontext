import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WorkspaceManager } from "@/components/app/workspace-manager";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { listWorkspaces } from "@/server/workspaces";

export const metadata: Metadata = {
  title: "Teams — OpenContext",
  description: "Shared OpenContext workspaces for analysis jobs and members.",
};

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/app/teams")}`);
  }
  const workspaces = await listWorkspaces(session.user.id);
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-mono">Collaboration</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  Teams
                </h1>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
                  Share analyses with existing teammates without making a job
                  public. Each uploaded team job records its destination.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/app/jobs" variant="ghost" size="sm">
                  Your jobs
                </ButtonLink>
                <ButtonLink href="/app/usage" variant="ghost" size="sm">
                  Usage
                </ButtonLink>
                <ButtonLink href="/app/new" size="sm">
                  New analysis
                </ButtonLink>
              </div>
            </div>
            <WorkspaceManager initial={workspaces} currentUserId={session.user.id} />
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
