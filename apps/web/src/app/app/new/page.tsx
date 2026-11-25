import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NewJobForm } from "@/components/app/new-job-form";
import { UrlImportForm } from "@/components/app/url-import-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { hasWorkspacePermission, listWorkspaces } from "@/server/workspaces";

export const metadata: Metadata = {
  title: "New analysis — OpenContext",
  description:
    "Upload a video, screen recording, audio file, image set, or PDF and generate structured developer context for text-only AI agents.",
};

export const dynamic = "force-dynamic";

/**
 * New-job page (upload.md + analysis-modes.md). Middleware protects /app;
 * this page re-checks the session so an expired cookie redirects through
 * sign-in with the destination preserved (identity.md B5).
 */
export default async function NewAnalysisPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/app/new")}`);
  }
  const allWorkspaces = await listWorkspaces(session.user.id);
  const canCreateFlags = await Promise.all(
    allWorkspaces.map((workspace) =>
      hasWorkspacePermission(workspace.id, session.user.id, "jobs:create"),
    ),
  );
  const workspaces = allWorkspaces
    .filter((_, index) => canCreateFlags[index])
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      role: (workspace.role === "VIEWER" ? "MEMBER" : workspace.role) as
        | "OWNER"
        | "ADMIN"
        | "MEMBER",
    }));

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-mono">Upload</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  New analysis
                </h1>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
                  Upload a video, screen recording, audio file, image set, or PDF.
                  OpenContext extracts speech and visual details into an
                  evidence-linked developer context document you can copy into
                  any text-only agent.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/app/jobs" variant="ghost" size="sm">
                  Your jobs
                </ButtonLink>
                <ButtonLink href="/app/teams" variant="ghost" size="sm">
                  Teams
                </ButtonLink>
                <ButtonLink href="/app/usage" variant="ghost" size="sm">
                  Usage
                </ButtonLink>
              </div>
            </div>

            <NewJobForm workspaces={workspaces} />

            <div className="mt-6">
              <UrlImportForm workspaces={workspaces} />
            </div>

            <p className="mt-6 text-xs leading-relaxed text-ink-faint">
              Want to see the output format first? The{" "}
              <Link
                href="/demo"
                className="rounded-sm text-accent underline-offset-2 hover:underline"
              >
                demo
              </Link>{" "}
              shows a completed analysis end to end without uploading anything.
            </p>

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
