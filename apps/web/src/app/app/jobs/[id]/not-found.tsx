import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

/**
 * /app/jobs/[id] → job deleted or never existed (jobs.md B10: "its URL
 * shows a 'Job not found' message"). Shown for 404s raised inside the
 * job page after ownership lookup.
 */
export default function JobNotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <div className="mx-auto max-w-3xl">
            <Card className="max-w-lg">
              <p className="label-mono">404</p>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-ink">
                Job not found
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                This job does not exist, or it was deleted. Completed jobs are
                kept for 14 days and unfinished ones for 7, then removed
                automatically.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href="/app/jobs" variant="secondary" size="sm">
                  Your jobs
                </ButtonLink>
                <ButtonLink href="/app/new" variant="ghost" size="sm">
                  New analysis
                </ButtonLink>
              </div>
            </Card>
            <div className="mt-8">
              <Link
                href="/"
                className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Back to the landing page
              </Link>
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
