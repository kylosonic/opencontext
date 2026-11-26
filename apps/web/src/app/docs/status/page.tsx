import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Status & limits — OpenContext Docs",
  description:
    "Available capabilities, deployment verification notes, measured benchmarks, and preview boundaries for OpenContext.",
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
              "Audio-only transcription for MP3, M4A, WAV, OGG, AAC, and FLAC",
              "Faster Whisper, OpenAI-compatible audio, and Ollama provider paths",
              "Team-shared jobs, expiring read-only public links, and URL imports",
              "Live job events with automatic polling fallback",
              "Evidence review, Markdown and JSON exports, and retry",
              "Idempotent usage accounting and optional Stripe subscription billing",
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
            separate from the published v0.1.3 packages.
          </div>
        </section>

        <section aria-labelledby="limitations-title">
          <h2 id="limitations-title" className="text-xl font-semibold text-ink">
            Known limits
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Quality evidence now includes a clean read-speech sample,
              32 far-field AMI conversational clips, and 16 real Screen2Words
              screenshots. The local tiny English speech model scored 61.83%
              WER and 43.81% CER on the concatenated noisy corpus, so this is
              evidence of difficulty rather than general accuracy. The
              real-world visual set currently verifies ingestion and scoring
              plumbing with fixture output; a measured image-capable model run
              is still required.
            </li>
            <li>
              A PostgreSQL pool configuration, Vercel WAF policy script, and
              weekly OWASP ZAP workflow are present, but sustained hosted
              traffic tuning and an independent human penetration test remain.
            </li>
            <li>
              The scheduled worker and authenticated operations-alert checker
              are verified. A Render persistent-worker blueprint is checked in,
              but no live persistent host has been verified.
            </li>
            <li>
              Public sharing and URL ingestion are read-only/import workflows,
              not collaboration on a live media stream. URL servers must expose{" "}
              <code>Content-Length</code>, and serverless duration limits bound very large
              imports. Stripe subscription Checkout, Billing Portal, signed
              webhooks, customer mapping, and usage invoice items are implemented,
              but billing stays disabled without an explicitly configured price
              and test-mode key. Usage charges also require an enabled flag,
              positive resale prices, and a billable subscription. Tax, refunds,
              dunning, and final invoice policy remain operator choices.
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
