import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { PipelineStrip } from "@/components/pipeline-strip";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const PIPELINE_STEPS = [
  {
    label: "Video",
    detail:
      "A recording, screen capture, or visual reference is the input.",
  },
  {
    label: "Audio + Frames",
    detail:
      "Audio is extracted for transcription; representative frames are sampled for vision.",
  },
  {
    label: "Transcription + Vision",
    detail:
      "Speech is transcribed with timestamps. Frames are described by a vision model and visible text is captured.",
  },
  {
    label: "Structured Context",
    detail:
      "Everything is aligned by timestamp and aggregated into one chronological document.",
  },
  {
    label: "Text-only AI",
    detail:
      "Copy the context into OpenCode, Claude Code, Cursor, or any local LLM.",
  },
];

/** Illustrative developer example — how a recording becomes context. */
const DEVELOPER_EXAMPLE = `[00:00–00:08]
A mobile application dashboard is visible.
VISUAL: Light interface with rounded cards; a greeting,
        a balance card, and a recent-transactions list. [E0001 · 00:02 · Observed]
UI: Header · Account balance · Transaction list · Bottom navigation
TRANSCRIPT: "This is the home dashboard. You can see the greeting,
            the checking account balance, and recent transactions." [E0002 · 00:04 · Observed]

---

[00:09–00:21]
USER ACTION: The user selects Send Money. [E0003 · 00:12 · Inferred]
VISUAL: The application navigates to a transfer form.
UI: Recipient field · Amount field · Continue button
OCR: "Send Money" · "$45.00" · "Continue"`;

const WHY_CARDS = [
  {
    title: "Text-only agents can't watch",
    body: "Most local and inexpensive models only read text. Videos, UI demos, and screen recordings are invisible to them — OpenContext translates those into something they can read.",
  },
  {
    title: "Every claim has a source",
    body: "Transcript, UI, OCR, and design findings carry evidence IDs, source timestamps, and certainty labels. Jump to a referenced moment, confirm or flag a claim, and keep reviewer notes with the handoff.",
  },
  {
    title: "One handoff, two useful formats",
    body: "Copy or download a readable Markdown brief, or use structured JSON with the same evidence ledger and review notes. Interactions stay clearly marked as inferred.",
  },
  {
    title: "Built in the open",
    body: "OpenContext is open source under the MIT License. The pipeline, the output format, and the roadmap are all visible in the repository.",
  },
];

const HOW_IT_WORKS_STEPS = [
  "Upload a video or screen recording",
  "Extract audio and sample representative frames",
  "Transcribe speech with timestamps",
  "Analyze frames with a vision model",
  "Capture visible text (OCR)",
  "Align every observation to the timeline",
  "Aggregate into a chronological context document",
  "Generate developer context for coding agents",
  "Copy it into your agent and go",
];

const ROADMAP_ITEMS = [
  {
    label: "Built in this branch",
    tone: "success" as const,
    items: ["GitHub sign-in, video uploads, job tracking, and results", "Python worker for extraction, transcription, vision, and context", "Markdown/JSON handoff with clickable evidence references"],
  },
  {
    label: "Next gate",
    tone: "warning" as const,
    items: ["Fresh web and worker verification", "End-to-end integration and security review", "Production deployment and upload-path decision"],
  },
  {
    label: "Research backlog",
    tone: "neutral" as const,
    items: ["MCP/agent connections", "Repository-aware implementation briefs", "Reusable video workflows and regression checks"],
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* ------------------------------ Hero ------------------------------ */}
        <section aria-labelledby="hero-title">
          <Container className="pb-16 pt-16 sm:pb-24 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
                <Badge tone="accent" mono>MIT licensed · open source</Badge>
                <Badge tone="neutral" mono>Working preview</Badge>
              </div>
              <h1
                id="hero-title"
                className="text-4xl font-bold tracking-tight text-ink sm:text-5xl md:text-6xl"
              >
                Give text-only AI agents eyes and ears.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted sm:text-xl">
                OpenContext turns videos and screen recordings into evidence-
                linked context that text-only coding agents can use and
                developers can verify.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <ButtonLink href="/app/new" size="lg">
                  Analyze a Video
                </ButtonLink>
                <ButtonLink
                  href="https://github.com/kylosonic/opencontext"
                  variant="secondary"
                  size="lg"
                >
                  View on GitHub
                </ButtonLink>
                <ButtonLink href="/demo" variant="ghost" size="lg">
                  Run Demo Analysis
                </ButtonLink>
              </div>
              <p className="mt-6 text-sm text-ink-faint">
                Every extracted fact keeps its source time and certainty. The
                demo shows the output format without an account or API key.
              </p>
            </div>
          </Container>
        </section>

        {/* ------------------------- Pipeline visual ------------------------ */}
        <section aria-labelledby="pipeline-title" className="border-y border-line bg-panel-muted/60 py-14 sm:py-20">
          <Container>
            <h2 id="pipeline-title" className="sr-only">
              How video becomes context
            </h2>
            <PipelineStrip
              steps={PIPELINE_STEPS}
              caption="The demo replays the same output format with pre-authored data; authenticated uploads run through the job API and Python worker."
            />
            <div className="mt-10">
              <h3 className="label-mono mb-3">
                Developer example — illustrative
              </h3>
              <CodeBlock
                code={DEVELOPER_EXAMPLE}
                label="Illustrative example: how a screen recording becomes context"
                wrap
              />
              <p className="mt-3 text-sm text-ink-faint">
                Items that are not directly visible in the recording are marked{" "}
                <span className="font-mono">Inferred</span> or{" "}
                <span className="font-mono">Uncertain</span> — never asserted as
                fact.
              </p>
            </div>
          </Container>
        </section>

        {/* ------------------------- Why OpenContext? ----------------------- */}
        <Section
          id="why"
          kicker="Why OpenContext?"
          title="Visual information, translated for text-only models"
          description="Developers increasingly run local and text-only models. When the reference material is a video, a recording of a UI, or a demo someone sent you, those models cannot see it. OpenContext bridges that gap."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {WHY_CARDS.map((card) => (
              <Card key={card.title} className="flex flex-col gap-2">
                <h3 className="text-base font-semibold text-ink">
                  {card.title}
                </h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {card.body}
                </p>
              </Card>
            ))}
          </div>
        </Section>

        {/* -------------------------- How it works -------------------------- */}
        <Section
          id="how-it-works"
          kicker="How it works"
          title="From recording to copy-pasteable context"
          description="Nine deterministic stages turn media into a document a coding agent can act on. Each stage reports its own status, so a job is never a black box."
        >
          <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
            <ol className="grid gap-3 sm:grid-cols-2">
              {HOW_IT_WORKS_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="flex items-start gap-3 rounded-lg border border-line bg-panel p-4"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[0.7rem] text-ink-muted">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-relaxed text-ink">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <aside className="lg:w-72">
              <Card raised className="border-warn-bg bg-warn-bg/40">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Badge tone="warning" mono>Status</Badge>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  The demo replays this pipeline end to end with pre-authored
                  sample data. Uploaded jobs use the same staged pipeline and
                  show their real processing status.
                </p>
              </Card>
            </aside>
          </div>
        </Section>

        {/* ------------------------- Developer Mode ------------------------- */}
        <Section
          id="developer-mode"
          kicker="Developer Mode"
          title="The deliverable is developer context"
          description="Every analysis produces a verifiable handoff: copy or download Markdown, or export the structured evidence ledger as JSON."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="gap-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
                Copy Context
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                One click puts the complete document on your clipboard, ready
                to paste into a coding agent. Clipboard blocked? A fallback
                dialog selects the text for manual copy.
              </p>
            </Card>
            <Card className="gap-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
                Download Markdown
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Save the document as{" "}
                <code className="text-[0.8rem]">opencontext-&lt;job-id&gt;.md</code>{" "}
                — viewable in any Markdown editor and identical to the copied
                text.
              </p>
            </Card>
            <Card className="gap-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
                Download JSON
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                The full structured result — timestamps, transcript segments,
                observations, OCR, and metadata — for your own integrations.
              </p>
            </Card>
          </div>
          <p className="mt-6 text-sm leading-relaxed text-ink-faint">
            Try the output in the{" "}
            <Link
              href="/demo"
              className="rounded-sm text-accent underline-offset-2 hover:underline"
            >
              demo
            </Link>
            {" "}demo, or use it with your uploaded jobs when the app is configured.
          </p>
        </Section>

        {/* ---------------------------- Local AI ---------------------------- */}
        <Section
          id="local-ai"
          kicker="Local AI"
          title="Your models, your machine"
          description="OpenContext is designed around a provider abstraction, so analysis can run on local models with no data leaving your machine."
          accessory={<Badge tone="neutral" mono>Provider adapters implemented</Badge>}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <h3 className="text-sm font-semibold text-ink">Transcription</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Local speech-to-text via faster-whisper, or any
                OpenAI-compatible transcription endpoint.
              </p>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-ink">Vision + OCR</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Frame analysis through local vision models (Ollama) or an
                OpenAI-compatible vision API, with text extraction included.
              </p>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-ink">Configuration</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Providers are chosen with environment variables —{" "}
                <code className="text-[0.8rem]">VISION_PROVIDER</code>,{" "}
                <code className="text-[0.8rem]">TRANSCRIPTION_PROVIDER</code>,{" "}
                <code className="text-[0.8rem]">TEXT_PROVIDER</code> — not
                hard-coded to any vendor.
              </p>
            </Card>
          </div>
        </Section>

        {/* -------------------------- Open Source --------------------------- */}
        <Section
          id="open-source"
          kicker="Open Source"
          title="MIT licensed, built in the open"
          description="Every stage of the pipeline and every decision is visible in the repository. Roadmaps are honest about what exists and what is coming."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <h3 className="text-base font-semibold text-ink">Repository</h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                Source, issue tracker, and contribution guide live at{" "}
                <a
                  href="https://github.com/kylosonic/opencontext"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm font-mono text-[0.85rem] text-accent underline-offset-2 hover:underline"
                >
                  github.com/kylosonic/opencontext
                </a>
                .
              </p>
              <div className="mt-auto flex gap-2">
                <ButtonLink
                  href="https://github.com/kylosonic/opencontext"
                  variant="secondary"
                  size="sm"
                >
                  View on GitHub
                </ButtonLink>
              </div>
            </Card>
            <Card className="flex flex-col gap-4">
              <h3 className="text-base font-semibold text-ink">Roadmap status</h3>
              <dl className="grid gap-4">
                {ROADMAP_ITEMS.map((group) => (
                  <div key={group.label} className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                    <dt className="flex items-center">
                      <Badge tone={group.tone} mono>{group.label}</Badge>
                    </dt>
                    <dd className="text-sm leading-relaxed text-ink-muted">
                      {group.items.join(" · ")}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </Section>

        {/* -------------------------- Architecture -------------------------- */}
        <Section
          id="architecture"
          kicker="Architecture"
          title="A small, separable pipeline"
          description="The web app, a queue, a Python worker, and durable storage stay independent — so heavy media processing never runs inside the web tier."
          accessory={<Badge tone="neutral" mono>Target architecture</Badge>}
        >
          <Card className="overflow-x-auto" padded>
            <ol
              className="flex min-w-max flex-wrap items-center gap-2 font-mono text-xs"
              aria-label="Target architecture: browser to web app to queue to worker to storage and back"
            >
              {[
                "Browser",
                "Next.js · web + API",
                "Queue",
                "Python worker · FFmpeg · Whisper · Vision · OCR",
                "PostgreSQL + object storage",
                "Results",
                "UI",
              ].map((node, index, nodes) => (
                <li key={node} className="flex items-center gap-2">
                  <span className="rounded-md border border-line bg-panel-muted px-3 py-2 text-ink">
                    {node}
                  </span>
                  {index < nodes.length - 1 && (
                    <span aria-hidden="true" className="text-ink-faint">→</span>
                  )}
                </li>
              ))}
            </ol>
          </Card>
          <p className="mt-4 text-sm leading-relaxed text-ink-faint">
            The web app, queue, worker, and storage are implemented in the
            current branch. Production hosting and end-to-end verification are
            still pending; this diagram shows the intended deployment shape.
          </p>
        </Section>

        {/* ---------------------- MCP integration (future) ------------------- */}
        <Section
          id="mcp"
          kicker="MCP integration"
          title="MCP server — future roadmap"
          description="A planned MCP server would let agents ask questions directly instead of pasting a document."
          accessory={<Badge tone="warning" mono>Future · not built yet</Badge>}
        >
          <Card className="border-dashed">
            <p className="text-sm leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink">Planned, not implemented.</span>{" "}
              The target experience: an agent asks{" "}
              <em className="font-mono not-italic text-ink">
                “What happens at 01:24?”
              </em>{" "}
              or{" "}
              <em className="font-mono not-italic text-ink">
                “Which UI elements are on the dashboard?”
              </em>{" "}
              and OpenContext answers from the structured result — no manual
              copy and paste. This is tracked on the roadmap; follow the
              repository for updates.
            </p>
          </Card>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
