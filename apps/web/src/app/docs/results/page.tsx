import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Results & evidence — OpenContext Docs",
  description:
    "Inspect source media, verify evidence claims and certainty labels, save reviews, and export Markdown or JSON.",
};

const TABS = [
  [
    "Transcript",
    "Timestamped speech, or a source-specific explanation when transcription does not apply.",
  ],
  [
    "Agent Context",
    "The primary handoff: structured context with source-time and evidence markers.",
  ],
  [
    "Visual Analysis",
    "What is visible in frames, images, or PDF pages, including source identifiers.",
  ],
  ["Timeline", "A chronological sequence of observations across the source."],
  ["OCR", "Visible or embedded text extracted from the source."],
  [
    "Evidence Review",
    "Owner and team-admin annotations attached to individual evidence claims.",
  ],
] as const;

export default function ResultsPage() {
  return (
    <DocsShell
      kicker="Get started"
      title="Results & evidence"
      description="OpenContext produces a readable handoff with a traceable ledger behind every claim."
      accessory={
        <Badge tone="success" mono>
          Evidence Review verified
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="tabs-title">
          <h2 id="tabs-title" className="text-xl font-semibold text-ink">
            Result views
          </h2>
          <p className="mt-3">
            A completed job opens on Agent Context. Other views make the result
            inspectable from different angles, and selecting a transcript,
            evidence, or timeline entry seeks an available video or audio player
            to its timestamp, or switches to the matching image or PDF page.
          </p>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {TABS.map(([tab, detail]) => (
              <div
                key={tab}
                className="grid gap-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
              >
                <h3 className="font-medium text-ink">{tab}</h3>
                <p>{detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-4">
            For an image set or PDF, the source viewer switches between ordered
            images or pages. Audio-only jobs populate Transcript, Timeline, and
            Agent Context, and explain why Visual Analysis and OCR do not apply.
            An unavailable source does not remove completed results or exports.
          </p>
        </section>

        <section aria-labelledby="certainty-title">
          <h2 id="certainty-title" className="text-xl font-semibold text-ink">
            What a claim means
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Label
                  </th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Meaning
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Observed",
                    "Directly present in the transcript, visible text, or source frame.",
                  ],
                  [
                    "Inferred",
                    "A reasoned interpretation; check it against the source.",
                  ],
                  [
                    "Uncertain",
                    "The source does not support a confident conclusion. It remains labeled, rather than being presented as fact.",
                  ],
                ].map(([label, detail]) => (
                  <tr
                    key={label}
                    className="border-b border-line last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-ink">
                      {label}
                    </td>
                    <td className="px-3 py-3">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            Evidence references use stable IDs, source timestamps, and
            collection indexes. Image observations use <code>image-NN</code>{" "}
            identifiers and PDF observations use <code>pdf-page-NN</code>, so a
            claim still points to the right source when a job has more than one
            image or page.
          </p>
        </section>

        <section aria-labelledby="review-title">
          <h2 id="review-title" className="text-xl font-semibold text-ink">
            Review a claim
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            <li>
              Open Evidence Review on a job you own or administer in a team
              (other team members have view-only access to jobs they did not
              create).
            </li>
            <li>
              Confirm a claim, or flag it and optionally add a note or a
              suggested correction.
            </li>
            <li>Save the review. The original model claim remains intact.</li>
            <li>Clear the review later if needed.</li>
          </ol>
          <p className="mt-4">
            Saved reviews appear in Markdown under a separate Human review
            section, and are attached to matching records in JSON. A review
            supplements the evidence rather than rewriting the original claim.
            Demo evidence is read-only.
          </p>
        </section>

        <section aria-labelledby="export-title">
          <h2 id="export-title" className="text-xl font-semibold text-ink">
            Copy or export
          </h2>
          <p className="mt-3">
            Use the result page to copy the context or download Markdown. The
            API can return Markdown or the complete structured JSON for a
            finished job.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="JSON export request"
              code={`const response = await fetch(
  "/api/jobs/job_123/export?format=json",
  { credentials: "include" },
);
if (!response.ok) throw new Error(\`Export failed: \${response.status}\`);
const result = await response.json();`}
            />
          </div>
          <p className="mt-4">
            Use the{" "}
            <Link href="/docs/api" className="text-accent hover:underline">
              Jobs API reference
            </Link>{" "}
            for authentication and endpoint details.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
