import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "CLI & packages — OpenContext Docs",
  description:
    "Analyze media locally with the Python opencontext-video package or install shared TypeScript schemas from npm.",
};

export default function PackagesPage() {
  return (
    <DocsShell
      kicker="Local tools"
      title="CLI & packages"
      description="The Python package can analyze local media without a web account. The npm package provides the shared TypeScript data contracts."
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="install-title">
          <h2 id="install-title" className="text-xl font-semibold text-ink">
            Install
          </h2>
          <p className="mt-3">
            Install from PyPI. The <code>local</code> extra provides local speech recognition.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Install the Python package"
              code={`python -m pip install "opencontext-video[local]==0.1.1"`}
            />
          </div>
          <p className="mt-4">The TypeScript schemas are available from npm.</p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Install the npm schemas"
              code={`npm install @kylosonic/opencontext-schemas@0.1.1`}
            />
          </div>
        </section>

        <section aria-labelledby="analyze-title">
          <h2 id="analyze-title" className="text-xl font-semibold text-ink">
            Analyze media
          </h2>
          <p className="mt-3">
            Videos, audio files, still images, and PDFs use the same local
            command and output contract.
          </p>
          <div className="mt-4 space-y-3">
            <CodeBlock
              wrap
              label="Video analysis"
              code={`opencontext analyze recording.mp4 \\
  --sampling-mode hybrid --scene-threshold 0.25 \\
  --out context.md --json context.json`}
            />
            <CodeBlock
              wrap
              label="Offline fixture analysis"
              code={`opencontext analyze mockup.png \\
  --offline --out context.md --json context.json`}
            />
          </div>
          <p className="mt-4">
            <code>--sampling-mode hybrid</code> captures FFmpeg scene transitions alongside interval keyframes (controlled by <code>--scene-threshold</code> in 0.05–0.95).{" "}
            <code>--offline</code> exercises extraction and export with labeled fixture transcription and vision data. It does not claim model inference.
          </p>
        </section>

        <section aria-labelledby="brief-title">
          <h2 id="brief-title" className="text-xl font-semibold text-ink">
            Build and verify
          </h2>
          <div className="mt-3 space-y-3">
            <CodeBlock
              wrap
              label="Repository-aware brief"
              code={`opencontext brief context.json --repo ../my-app \\
  --task "Implement the recorded checkout flow" \\
  --out implementation-brief.md`}
            />
            <CodeBlock
              wrap
              label="Check local readiness"
              code={`opencontext doctor --offline
opencontext doctor --offline --json`}
            />
          </div>
          <p className="mt-4">
            <code>doctor</code> reports setup checks without printing secret values. Add <code>--check-network</code> to opt into provider reachability checks.
          </p>
        </section>

        <section aria-labelledby="cli-reference-title">
          <h2 id="cli-reference-title" className="text-xl font-semibold text-ink">
            Command summary
          </h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {[
              ["opencontext analyze", "Analyze a file or every supported file in a directory."],
              ["opencontext brief", "Generate a repository-aware implementation brief from JSON."],
              ["opencontext replay", "Validate an evidence ledger and regenerate a brief."],
              ["opencontext evaluate", "Score a context result against ground truth."],
              ["opencontext doctor", "Check local runtime and provider configuration."],
            ].map(([command, purpose]) => (
              <div key={command} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <code className="text-xs text-ink">{command}</code>
                <p>{purpose}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
