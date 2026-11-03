import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { JobDetailClient } from "@/components/app/job-detail";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getJob } from "@/server/jobs";
import { buildResultView } from "@/server/jobs/jobViews";
import { loadJobResultsData } from "@/server/jobs/loadJobResults";
import { storage } from "@/server/storage";

export const metadata: Metadata = {
  title: "Job — OpenContext",
  description:
    "A single OpenContext analysis: processing progress, and the generated developer context.",
};

export const dynamic = "force-dynamic";

/**
 * Job detail page (jobs.md B1-B6/B9/B10). Middleware gates /app; this
 * page re-checks the session, verifies ownership server-side, and
 * pre-renders state. For terminal COMPLETED/PARTIAL jobs the result
 * payload is composed here (rows + ProcessingResult, mapped onto the
 * results-shell prop contract) so the client never needs a results API.
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/app/jobs/${id}`)}`,
    );
  }

  const result = await getJob(id, session.user.id);
  if (result.kind === "NOT_FOUND") {
    notFound();
  }
  if (result.kind === "FORBIDDEN") {
    return <AccessDenied />;
  }

  const detail = result.job;

  // Composed results-shell payload; only terminal jobs have result rows.
  let resultView: ReturnType<typeof buildResultView> | null = null;
  if (detail.status === "COMPLETED" || detail.status === "PARTIAL") {
    try {
      const data = await loadJobResultsData(detail.id);
      resultView = buildResultView(detail, data);
    } catch (error) {
      console.error("Result composition failed:", error);
    }
  }

  // Source player: only after extraction has validated the file, and only
  // on deployments that can stream media back (S3 presign; local disk
  // cannot - results.md B2 edge case shown honestly).
  let videoUrl: string | null = null;
  let videoUnavailableNote: string | null = null;
  const playerReached =
    detail.status === "COMPLETED" ||
    detail.status === "PARTIAL" ||
    ["EXTRACTING", "TRANSCRIBING", "ANALYZING", "AGGREGATING", "GENERATING_CONTEXT"].includes(detail.status);
  if (playerReached && detail.source?.key) {
    try {
      videoUrl = await storage.presign(detail.source.key, 900);
    } catch (error) {
      console.error("Source presign failed:", error);
      videoUrl = null;
    }
    if (videoUrl === null) {
      videoUnavailableNote =
        "This deployment stores media on local disk, so the source video is not streamed back to the browser. Transcripts, analysis, and exports are unaffected.";
    }
  }

  return (
    <JobPageShell>
      <JobDetailClient
        // The island polls live state; when a terminal transition arrives
        // the server refresh delivers new props and this key changes,
        // remounting the island against the composed result payload.
        key={`${detail.updatedAt}:${resultView ? "result" : "state"}`}
        detail={detail}
        resultView={resultView}
        videoUrl={videoUrl}
        videoUnavailableNote={videoUnavailableNote}
      />
    </JobPageShell>
  );
}

/** Identity.md B4: another user's job - never its content. */
async function AccessDenied() {
  return (
    <JobPageShell>
      <Card className="max-w-lg">
        <h1 className="text-base font-semibold text-ink">
          You do not have access to this job
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Job links are private to the account that created them. If you
          expected access, sign in with that account and try again.
        </p>
        <div className="mt-4 flex gap-2">
          <ButtonLink href="/app/jobs" variant="secondary" size="sm">
            Your jobs
          </ButtonLink>
          <ButtonLink href="/auth/signout" variant="ghost" size="sm">
            Switch account
          </ButtonLink>
        </div>
      </Card>
    </JobPageShell>
  );
}

function JobPageShell({ children }: { children: ReactNode }) {
  return (
    <main id="main">
      <Container className="pb-16 pt-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6">
            <Link
              href="/app/jobs"
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              ← All jobs
            </Link>
          </div>
          {children}
        </div>
      </Container>
    </main>
  );
}
