import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Job lifecycle - OpenContext docs",
};

const STAGES = [
  ["Downloading", "The worker claims the job and retrieves the source."],
  [
    "Extracting",
    "Audio, representative video frames, images, or PDF pages are prepared.",
  ],
  [
    "Transcribing",
    "Speech becomes timestamped transcript segments when audio is present.",
  ],
  ["Analyzing", "Visual observations and visible text are extracted."],
  ["Aggregating", "Claims are ordered on a shared timeline."],
  ["Generating context", "The final structured result is produced."],
] as const;

export default function JobsPage() {
  return (
    <DocsShell
      kicker="Get started"
      title="Job lifecycle"
      description="A job preserves one source and its progress, results, review notes, and retention window."
      accessory={
        <Badge tone="success" mono>
          Progress and retry verified
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="states-title">
          <h2 id="states-title" className="text-xl font-semibold text-ink">
            Status and stages
          </h2>
          <p className="mt-3">
            A job begins as <code>QUEUED</code>. While it is active, the page
            checks for updates every three seconds and shows the current stage
            and overall progress. Polling stops at <code>COMPLETED</code>,{" "}
            <code>PARTIAL</code>, or <code>FAILED</code>.
          </p>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {STAGES.map(([stage, detail], index) => (
              <li
                key={stage}
                className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4"
              >
                <span className="font-mono text-xs text-ink-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-medium text-ink">{stage}</h3>
                  <p className="mt-1">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4">
            A lost connection shows a reconnect notice but does not change the
            job&apos;s state. Updates resume when the page can reach OpenContext
            again.
          </p>
        </section>

        <section aria-labelledby="outcomes-title">
          <h2 id="outcomes-title" className="text-xl font-semibold text-ink">
            Completion outcomes
          </h2>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {[
              [
                "COMPLETED",
                "Every applicable stage succeeded and the result is ready to review and export.",
              ],
              [
                "PARTIAL",
                "At least one stage succeeded, but another failed. Completed content remains available, and the page names the failed stage.",
              ],
              [
                "FAILED",
                "Analysis could not produce a usable result. The page gives the failure reason and whether retry is possible.",
              ],
            ].map(([status, detail]) => (
              <div
                key={status}
                className="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"
              >
                <code className="font-mono text-xs text-ink">{status}</code>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="retry-title">
          <h2 id="retry-title" className="text-xl font-semibold text-ink">
            Retry
          </h2>
          <p className="mt-3">
            Transient provider or network problems are retried automatically a
            limited number of times. If a stage still fails, a{" "}
            <code>PARTIAL</code> job, or a <code>FAILED</code>
            job caused by a transient problem, can be retried manually.
          </p>
          <p className="mt-3">
            Retry keeps the same job and URL. Completed or skipped stages are
            reused; failed and not-yet-run stages resume. Validation failures
            and other permanent file or provider errors offer no retry because
            repeating the same request cannot fix them.
          </p>
        </section>

        <section aria-labelledby="delete-title">
          <h2 id="delete-title" className="text-xl font-semibold text-ink">
            Retention and deletion
          </h2>
          <p className="mt-3">
            Completed jobs and their media are kept for 14 days. Incomplete jobs
            are kept for seven days. After that, the job and stored artifacts
            are removed automatically.
          </p>
          <p className="mt-3">
            The owner can choose{" "}
            <strong className="text-ink">Delete job</strong> and confirm to
            remove it earlier. The confirmation names the job and states that
            deletion cannot be undone. The job disappears from the job list and
            its URL shows that the job is not found.
          </p>
          <p className="mt-3">
            See{" "}
            <Link href="/docs/security" className="text-accent hover:underline">
              security and retention
            </Link>{" "}
            for authentication, storage, and what data leaves the processing
            host.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
