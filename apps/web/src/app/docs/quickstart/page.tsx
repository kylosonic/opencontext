import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Quickstart — OpenContext Docs",
  description:
    "Use the hosted OpenContext app or run the full stack locally with Docker Compose.",
};

export default function QuickstartPage() {
  return (
    <DocsShell
      kicker="Get started"
      title="Quickstart"
      description="Use the hosted app, or run the full stack locally for development."
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="hosted-title">
          <h2 id="hosted-title" className="text-xl font-semibold text-ink">
            Analyze a recording
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            <li>
              Open the{" "}
              <Link href="/app/new" className="text-accent hover:underline">
                upload workspace
              </Link>{" "}
              and sign in with GitHub.
            </li>
            <li>Choose video, audio, a still image, image set, or PDF, or import a public media URL, then select the detail level.</li>
            <li>Wait for extraction, transcription, analysis, and context generation to finish.</li>
            <li>Review the evidence, then copy the context or download Markdown or JSON.</li>
          </ol>
          <p className="mt-4">
            You can inspect result formats without an upload in the{" "}
            <Link href="/demo" className="text-accent hover:underline">
              scripted demo
            </Link>
            . Demo output is clearly labeled and does not process your media.
          </p>
        </section>

        <section aria-labelledby="local-title">
          <h2 id="local-title" className="text-xl font-semibold text-ink">
            Run locally
          </h2>
          <p className="mt-3">
            Docker Compose starts PostgreSQL, the web app, and a worker with fixture providers for deterministic local development.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Local commands"
              code={`git clone https://github.com/kylosonic/opencontext
cd opencontext
docker compose up --build

# Then open http://localhost:3000`}
            />
          </div>
        </section>

        <section aria-labelledby="checks-title">
          <h2 id="checks-title" className="text-xl font-semibold text-ink">
            Repository checks
          </h2>
          <div className="mt-3 space-y-3">
            <CodeBlock
              wrap
              label="Web checks"
              code={`npm install
npm run lint
npm run typecheck
npm test
npm run build`}
            />
            <CodeBlock
              wrap
              label="Worker checks"
              code={`cd workers/processor
python -m venv .venv
.venv/bin/python -m pip install -e ".[dev,local]"
.venv/bin/python -m ruff check src tests
.venv/bin/python -m pytest -q`}
            />
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
