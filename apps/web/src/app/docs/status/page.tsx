import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Status & limits - OpenContext docs",
};

export default function StatusPage() {
  return (
    <DocsShell
      kicker="Project status"
      title="Status & limits"
      description="What OpenContext currently does, what is measured, and where it still needs more evidence."
      accessory={
        <Badge tone="warning" mono>
          Working preview
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="available-title">
          <h2 id="available-title" className="text-xl font-semibold text-ink">
            Available
          </h2>
          <ul className="mt-3 space-y-2">
            {[
              "GitHub sign-in, direct uploads, job tracking, and results",
              "Video, still image, ordered image set, and PDF processing",
              "Faster Whisper, OpenAI-compatible audio, and Ollama provider paths",
              "Evidence review, Markdown and JSON exports, and retry",
              "Local CLI, repository-aware briefs, replay checks, and an MCP server",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-ok">
                  +
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="deployment-title">
          <h2 id="deployment-title" className="text-xl font-semibold text-ink">
            Deployment evidence
          </h2>
          <p className="mt-3">
            The hosted deployment has recorded end-to-end photo and video jobs:
            all five stages reached 100%, with evidence IDs, source timestamps,
            certainty labels, and both exports verified. The 2026-11-24 rollout
            applied the PostgreSQL migration without drift and replayed three
            production exports.
          </p>
          <p className="mt-3">
            Jobs ran from the scheduled GitHub Actions worker. The public
            readiness endpoint reports aggregate status without subsystem
            details; authenticated readiness and operations alerts use the
            configured operations token. A persistent worker host still needs
            its own live restart and failover evidence before it can be called
            verified.
          </p>
          <div className="mt-3 border-l-2 border-line-strong pl-4 text-ink-faint">
            The public site can lag the repository. Production worker status is
            separate from the published v0.1.1 packages.
          </div>
        </section>

        <section aria-labelledby="limitations-title">
          <h2 id="limitations-title" className="text-xl font-semibold text-ink">
            Known limits
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The quality evidence covers a small synthetic visual flow and a
              clean English speech sample. It does not establish general
              accuracy.
            </li>
            <li>
              No sustained high-traffic or independent penetration test against
              the hosted service exists.
            </li>
            <li>
              The scheduled worker and authenticated operations-alert checker
              are verified, but no persistent worker host has been verified.
            </li>
            <li>
              Teams, public result sharing, URL ingestion, audio-only uploads,
              and real-time processing are not available.
            </li>
            <li>
              npm audit currently reports no known vulnerabilities in
              production or development dependencies. Recheck it on every
              release because advisories change over time.
            </li>
          </ul>
        </section>

        <section aria-labelledby="demo-title">
          <h2 id="demo-title" className="text-xl font-semibold text-ink">
            Demo data is fixture data
          </h2>
          <p className="mt-3">
            The interactive demo replays pre-authored data rather than
            processing an uploaded recording. It always carries a{" "}
            <strong className="text-ink">Demo Analysis</strong> marker. Offline
            CLI output uses fixture providers and is separately labeled from
            measured model runs.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
