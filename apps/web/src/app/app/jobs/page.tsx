import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JobsList } from "@/components/app/jobs-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { listJobs } from "@/server/jobs";

export const metadata: Metadata = {
  title: "Your jobs — OpenContext",
  description:
    "Your OpenContext analyses: uploads, processing progress, and completed developer context.",
};

export const dynamic = "force-dynamic";

/**
 * Job list page (jobs.md B8). Server-rendered first frame from the same
 * listJobs helper the API uses; the client island polls every 3s while
 * any job is active and stops when all are terminal.
 */
export default async function JobsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/app/jobs")}`);
  }
  const jobs = await listJobs(session.user.id);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-mono">OpenContext</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  Your jobs
                </h1>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
                  Every analysis starts as one uploaded video and ends as a
                  structured developer context document.
                </p>
              </div>
              <ButtonLink href="/app/new" size="sm">
                New analysis
              </ButtonLink>
            </div>

            <JobsList initialJobs={jobs} />

            <div className="mt-10 flex items-center justify-between border-t border-line pt-4">
              <p className="text-xs text-ink-faint">
                Completed jobs are kept for 14 days; unfinished ones for 7.
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
