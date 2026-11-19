import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DocsShell } from "@/components/docs-shell";
import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Documentation - OpenContext",
  description:
    "Install, call, and operate OpenContext for evidence-linked media context.",
};

const PATHS = [
  {
    href: "/docs/uploads",
    title: "Uploading media",
    text: "Choose a supported source and understand the format, size, and processing limits.",
  },
  {
    href: "/docs/jobs",
    title: "Job lifecycle",
    text: "Follow progress, handle partial failures, retry failed stages, and delete a job.",
  },
  {
    href: "/docs/results",
    title: "Results & evidence",
    text: "Inspect source media, review claims, and export Markdown or JSON.",
  },
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    text: "Run the hosted app or the complete development stack for the first time.",
  },
  {
    href: "/docs/packages",
    title: "CLI & packages",
    text: "Analyze media locally or install the shared TypeScript schemas.",
  },
  {
    href: "/docs/agents",
    title: "Agent integration",
    text: "Connect the local MCP server and build repository-aware implementation briefs.",
  },
] as const;

export default function DocsPage() {
  return (
    <DocsShell
      kicker="Documentation"
      title="How OpenContext works"
      description="Turn videos, image sets, and PDFs into timestamped, evidence-linked context that a text-only model can read."
      accessory={
        <Badge tone="success" mono>
          v0.1.0
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="context-title">
          <h2 id="context-title" className="text-xl font-semibold text-ink">
            What you get
          </h2>
          <p className="mt-3">
            Each completed job returns Markdown, JSON, and a readable set of
            transcript segments, visual observations, OCR text, and timeline
            entries. Claims distinguish{" "}
            <strong className="text-ink">observed</strong>,{" "}
            <strong className="text-ink">inferred</strong>, and{" "}
            <strong className="text-ink">uncertain</strong> evidence.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Context document example"
              code={`# Checkout flow

## Sequence
- [E-001] 00:12 - The cart shows three line items (observed)
- [E-008] 00:31 - The primary button reads "Pay now" (observed)
`}
            />
          </div>
        </section>

        <section aria-labelledby="pipeline-title">
          <h2 id="pipeline-title" className="text-xl font-semibold text-ink">
            The processing pipeline
          </h2>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {[
              [
                "Extract",
                "Probe media, extract audio, sample frames, or render PDF pages.",
              ],
              [
                "Transcribe",
                "Create timestamped speech segments. Sources without audio skip this stage.",
              ],
              [
                "Analyze",
                "Describe visuals and capture visible text with timestamped evidence.",
              ],
              [
                "Aggregate",
                "Order observations on a shared timeline and merge adjacent duplicates.",
              ],
              [
                "Generate",
                "Produce developer context in Markdown with matching JSON.",
              ],
            ].map(([stage, detail], index) => (
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
        </section>

        <section aria-labelledby="paths-title">
          <h2 id="paths-title" className="text-xl font-semibold text-ink">
            Choose a path
          </h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {PATHS.map((path) => (
              <Link
                key={path.href}
                href={path.href}
                className="group grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_1rem] sm:items-center sm:gap-4"
              >
                <span className="font-medium text-ink">{path.title}</span>
                <span>{path.text}</span>
                <ArrowRight
                  aria-hidden="true"
                  size={16}
                  className="hidden text-ink-faint group-hover:text-ink sm:block"
                />
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="boundaries-title">
          <h2 id="boundaries-title" className="text-xl font-semibold text-ink">
            Operational boundaries
          </h2>
          <div className="mt-3 space-y-2 border-l-2 border-line-strong pl-4">
            <p>
              Videos are limited to 500 MB and 30 minutes. Images are limited to
              25 MB each, PDFs to 50 MB and 30 pages, and image-set jobs to 10
              images.
            </p>
            <p>
              Completed job data is retained for 14 days; unfinished jobs for 7
              days.
            </p>
            <p>
              The production deployment is a working preview. Read{" "}
              <Link href="/docs/status" className="text-accent hover:underline">
                status and limits
              </Link>{" "}
              before relying on it for a critical workflow.
            </p>
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
