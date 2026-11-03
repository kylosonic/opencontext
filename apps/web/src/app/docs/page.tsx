import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { PipelineStrip } from "@/components/pipeline-strip";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Docs — OpenContext",
  description:
    "How OpenContext turns video into structured context for text-only AI agents.",
};

const PIPELINE_STEPS = [
  { label: "Video", detail: "Upload a recording or screen capture." },
  {
    label: "Audio + Frames",
    detail: "Extract audio and sample representative frames.",
  },
  {
    label: "Transcription + Vision",
    detail: "Transcribe speech; describe frames; capture visible text.",
  },
  {
    label: "Structured Context",
    detail: "Align everything to timestamps and aggregate.",
  },
  {
    label: "Text-only AI",
    detail: "Copy the context into your coding agent.",
  },
];

const STAGES = [
  {
    stage: "Extracting",
    what: "Probe the file, extract audio, sample frames (≈1/sec).",
    note: "Invalid files fail here with a specific reason.",
  },
  {
    stage: "Transcribing",
    what: "Timestamped speech segments from the audio track.",
    note: "Videos without audio skip this stage — not an error.",
  },
  {
    stage: "Analyzing",
    what: "Vision descriptions, UI inventories, OCR with timestamps.",
    note: "Every observation carries a certainty: observed / inferred / uncertain.",
  },
  {
    stage: "Aggregating",
    what: "Merge transcript, observations, and OCR chronologically.",
    note: "Adjacent duplicates are merged; timestamps are preserved.",
  },
  {
    stage: "Generating context",
    what: "Build the developer context document (Markdown + JSON).",
    note: "Deterministic template baseline; optional provider refinement.",
  },
];

const ENV_VARS = [
  ["VISION_PROVIDER", "vision model provider", "openai_compatible | ollama"],
  ["VISION_MODEL", "model name passed to the vision provider", "e.g. qwen2.5-vl"],
  ["TRANSCRIPTION_PROVIDER", "speech-to-text provider", "openai_compatible | faster_whisper"],
  ["TRANSCRIPTION_MODEL", "model name for transcription", "e.g. whisper-1"],
  ["TEXT_PROVIDER", "developer-context refinement provider", "openai_compatible | (none → template)"],
  ["TEXT_MODEL", "model name for text refinement", "e.g. deepseek-chat"],
] as const;

const DEMO_PROGRESS_EXAMPLE = `GET /api/demo/progress?elapsed=4.0

{
  "stages": [
    { "name": "Media extracted",              "status": "done" },
    { "name": "Transcription + vision",       "status": "done" },
    { "name": "Context aggregated",           "status": "running" },
    { "name": "Developer context generated",  "status": "pending" }
  ],
  "completed": false,
  "progress": 56
}`;

const TIMING_TABLE = `Stage                          completes at elapsed
──────────────────────────────────────────────────
Media extracted                            1.5s
Transcription + vision                     3.5s
Context aggregated                         5.5s
Developer context generated                7.5s
Job completed (progress 100)               8.0s

Responses are a pure function of the ?elapsed= parameter.
Invalid or negative values are treated as 0.`;

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-14">
          <header className="max-w-3xl">
            <p className="label-mono mb-3">Documentation</p>
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Docs
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              How OpenContext works, how to configure providers, and how to run
              it locally. Items marked{" "}
              <Badge tone="warning" mono>Planned</Badge> are designed but not
              yet available — this documentation never claims otherwise.
            </p>
          </header>
        </Container>

        <Section
          id="what"
          kicker="Overview"
          title="What OpenContext does"
          description="OpenContext is an open-source context engine: videos and screen recordings go in, an evidence-linked, timestamped handoff comes out — readable by any text-only model."
          flush
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold text-ink">The output</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                One document, three access paths: <strong>Copy Context</strong>{" "}
                to the clipboard, <strong>Download Markdown</strong> (
                <code className="text-[0.8rem]">opencontext-&lt;job-id&gt;.md</code>
                ), and <strong>Download JSON</strong> for integrations. Owners
                can also review evidence claims and include notes or suggested
                corrections in both exports.
              </p>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-ink">Honesty rules</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Observed, inferred, and uncertain are always distinguished.
                Functionality is never invented. Human reviews remain separate
                from the original extracted claim, and demo output is always labeled{" "}
                <Badge tone="accent" mono>Demo Analysis</Badge>.
              </p>
            </Card>
          </div>
        </Section>

        <Section
          id="demo-mode"
          kicker="Try it now"
          title="Demo mode"
          description="The public deployment always demonstrates the product, with or without AI credentials configured. The demo uses pre-authored sample data and never processes an uploaded video."
        >
          <Card className="max-w-2xl">
            <p className="text-sm leading-relaxed text-ink-muted">
              Run the demo from the{" "}
              <Link href="/" className="rounded-sm text-accent underline-offset-2 hover:underline">
                landing page
              </Link>{" "}
              or go straight to{" "}
              <Link
                href="/demo"
                className="rounded-sm font-mono text-[0.85rem] text-accent underline-offset-2 hover:underline"
              >
                /demo
              </Link>
              . The demo replays a scripted stage checklist over ~8 seconds,
              then renders a complete sample analysis — a 12-minute mobile
              banking app walkthrough — through the same results viewer a real
              job uses. A <Badge tone="accent" mono>Demo Analysis</Badge> badge
              stays visible throughout, and the exported document carries the
              same marker in its header.
            </p>
          </Card>
        </Section>

        <Section
          id="how-it-works"
          kicker="How it works"
          title="The pipeline"
          description="Five high-level steps, implemented as distinct stages with independent status reporting."
        >
          <PipelineStrip
            steps={PIPELINE_STEPS}
            caption="Authenticated uploads run through the job API and Python worker. The demo replays the same output format with pre-authored data."
          />
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Processing stages in detail</caption>
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">Stage</th>
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">What happens</th>
                  <th scope="col" className="py-2 font-mono text-xs uppercase tracking-wider text-ink-faint">Notes</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((row) => (
                  <tr key={row.stage} className="border-b border-line align-top">
                    <th scope="row" className="py-3 pr-4 font-medium text-ink">{row.stage}</th>
                    <td className="py-3 pr-4 text-ink-muted">{row.what}</td>
                    <td className="py-3 text-ink-muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Card>
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink-faint">Detail levels</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                <strong className="text-ink">LOW</strong> — every 10th frame,
                scene titles and changes. <strong className="text-ink">MEDIUM</strong>{" "}
                (default) — every 3rd frame, standard fields.{" "}
                <strong className="text-ink">HIGH</strong> — every frame, plus
                design observations and an exhaustive UI inventory.
              </p>
            </Card>
            <Card>
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink-faint">Certainty</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                <Badge tone="success" mono>Observed</Badge> directly visible or
                audible. <Badge tone="accent" mono>Inferred</Badge> consistent
                but not directly shown (all interactions are inferred by rule).{" "}
                <Badge tone="warning" mono>Uncertain</Badge> could not be
                confirmed.
              </p>
            </Card>
            <Card>
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink-faint">Retention</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Completed jobs keep media and results for 14 days; incomplete
                jobs for 7 days. Removal is automatic and silent.
              </p>
            </Card>
          </div>
        </Section>

        <Section
          id="api"
          kicker="API"
          title="Live endpoints"
          description="The demo endpoints are public. Job APIs require a signed-in owner, and worker endpoints require the service token."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <h3 className="font-mono text-sm font-semibold text-ink">
                GET /api/demo/result
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                Returns the complete pre-authored demo result verbatim:
                metadata, transcript segments, visual observations with
                certainty, OCR entries, timeline, and the full developer-context
                Markdown and evidence ledger (with the <em>Demo Analysis</em>
                header marker). Human review is available on owned job results;
                the demo remains read-only.
                Deterministic and cacheable; no database, environment, or
                credentials involved.
              </p>
              <CodeBlock
                wrap
                code={'{"metadata":{"id":"demo","durationSec":720,"detailLevel":"MEDIUM","demo":true,...},"transcript":[...],"observations":[...],"ocr":[...],"timeline":[...],"markdown":"# OpenContext — Demo Analysis\\n..."}'}
                label="Demo result response shape"
              />
            </Card>
            <Card className="flex flex-col gap-3">
              <h3 className="font-mono text-sm font-semibold text-ink">
                GET /api/demo/progress?elapsed=&lt;seconds&gt;
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                A scripted stage checklist computed as a pure function of the{" "}
                <code className="text-[0.8rem]">elapsed</code> parameter — not
                the server clock — so responses are fully deterministic.
              </p>
              <CodeBlock code={DEMO_PROGRESS_EXAMPLE} label="Demo progress response example" wrap />
              <CodeBlock code={TIMING_TABLE} label="Demo progress timing table" wrap />
            </Card>
          </div>
        </Section>

        <Section
          id="providers"
          kicker="Configuration"
          title="Provider configuration"
          description="OpenContext never couples to one AI vendor. Providers are selected through environment variables in the processing backend."
          accessory={<Badge tone="neutral" mono>Provider adapters implemented</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Environment variables for provider configuration</caption>
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">Variable</th>
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">Purpose</th>
                  <th scope="col" className="py-2 font-mono text-xs uppercase tracking-wider text-ink-faint">Values</th>
                </tr>
              </thead>
              <tbody>
                {ENV_VARS.map(([name, purpose, values]) => (
                  <tr key={name} className="border-b border-line align-top">
                    <th scope="row" className="py-3 pr-4 font-mono text-[0.8rem] text-ink">{name}</th>
                    <td className="py-3 pr-4 text-ink-muted">{purpose}</td>
                    <td className="py-3 font-mono text-[0.8rem] text-ink-muted">{values}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="local-dev"
          kicker="Local development"
          title="Run it locally"
          description="Run the web app and worker locally. The demo needs no credentials; authenticated processing needs GitHub OAuth and the configured database, storage, and model providers."
        >
          <CodeBlock
            wrap
            label="Local development commands"
            code={`git clone https://github.com/kylosonic/opencontext
cd opencontext
npm install
npm run dev          # web app at http://localhost:3000

npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run build        # production build`}
          />
          <p className="mt-4 text-sm leading-relaxed text-ink-faint">
            The demo works with zero configuration — visit{" "}
            <code className="text-[0.8rem]">/demo</code> after starting the dev
            server. Real uploads require a configured GitHub OAuth app,
            database, storage provider, and worker process.
          </p>
        </Section>

        <Section
          id="roadmap"
          kicker="Status"
          title="What exists today"
          description="An honest snapshot. Anything not listed as shipped is not claimable as shipped."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Badge tone="success" mono>Shipped</Badge> Landing + docs
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Public pages explaining the product, pipeline, and output
                format.
              </p>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Badge tone="success" mono>Shipped</Badge> Demo mode
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Pre-authored sample analysis with the scripted checklist and
                the full results viewer.
              </p>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Badge tone="success" mono>Built in current branch</Badge> Live job pipeline
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Authentication, uploads, queue, storage, job pages, and the
                Python worker are implemented; verification and deployment
                remain.
              </p>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Badge tone="neutral" mono>Research backlog</Badge> Agent connections
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                MCP tools, repository-aware implementation briefs, and video
                regression workflows are candidates for future slices.
              </p>
            </Card>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
