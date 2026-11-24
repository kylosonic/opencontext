import type { Metadata } from "next";
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
              <ButtonLink href="/app/jobs" variant="ghost" size="sm">All jobs</ButtonLink>
            </div>
            <WorkspaceManager initial={workspaces} />
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
