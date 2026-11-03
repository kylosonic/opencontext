import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NewJobForm } from "@/components/app/new-job-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "New analysis — OpenContext",
  description:
    "Upload a video or screen recording and generate structured developer context for text-only AI agents.",
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
                  Upload one video or screen recording. OpenContext extracts
                  audio, samples frames, and produces a timestamped developer
                  context document you can copy into any text-only agent.
                </p>
              </div>
              <ButtonLink href="/app/jobs" variant="ghost" size="sm">
                All jobs
              </ButtonLink>
            </div>

            <NewJobForm />

            <p className="mt-6 text-xs leading-relaxed text-ink-faint">
              Want to see the output format first? The{" "}
              <Link
                href="/demo"
                className="rounded-sm text-accent underline-offset-2 hover:underline"
              >
                demo
              </Link>{" "}
              shows a completed analysis end to end without uploading
              anything.
            </p>

            <div className="mt-10 flex items-center justify-between border-t border-line pt-4">
              <p className="text-xs text-ink-faint">
                Unfinished jobs are kept for 7 days; completed results for 14.
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
