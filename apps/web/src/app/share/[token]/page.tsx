import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui/container";
import { getSharedJob } from "@/server/jobs";
import { buildResultView } from "@/server/jobs/jobViews";
import { loadJobResultsData } from "@/server/jobs/loadJobResults";
import { SharedViewer } from "./shared-viewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared context — OpenContext",
  description: "A read-only OpenContext analysis shared by its owner.",
  robots: { index: false, follow: false },
};

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await getSharedJob(token);
  if (!shared) notFound();

  const data = await loadJobResultsData(shared.job.id);
  const result = buildResultView(shared.job, data);
  const sourceUrl = `/share/${encodeURIComponent(token)}/source`;
  const sourceAssets = shared.job.source?.assets ?? [];

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-8">
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-ink-muted">
              This is a read-only public snapshot. Downloads, review edits, job
              deletion, and account controls are disabled. The owner can revoke
              the link at any time.
            </div>
            <SharedViewer
              job={{
                id: shared.job.id,
                displayName: shared.job.displayName,
                status: shared.job.status,
                detailLevel: shared.job.detailLevel,
                audioPresent: shared.job.source?.audioPresent,
                sourceKind: shared.job.source?.kind,
                createdAt: shared.job.createdAt,
                expiresAt: shared.job.expiresAt,
                retentionNote: shared.job.retentionNote,
              }}
              result={result}
              sourceUrl={sourceUrl}
              imageCount={sourceAssets.length}
              pageCount={shared.job.source?.pageCount ?? 1}
            />
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
