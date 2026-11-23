import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Worker deployment - OpenContext docs",
};

export default function WorkersPage() {
  return (
    <DocsShell
      kicker="Operations"
      title="Worker deployment"
      description="Run the Python processor as a supervised, long-lived container that claims queued jobs through the web API."
      accessory={<Badge tone="neutral" mono>Container ready</Badge>}
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="requirements-title">
          <h2 id="requirements-title" className="text-xl font-semibold text-ink">
            Requirements
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Network access to the web API and every configured model provider.</li>
            <li>FFmpeg and Python 3.13+, or the included container image.</li>
            <li>The same <code>WORKER_API_TOKEN</code> used by the web app.</li>
            <li>A host that keeps the container running and restarts it after failure.</li>
            <li>A persistent volume for downloaded transcription models.</li>
          </ul>
        </section>

        <section aria-labelledby="run-title">
          <h2 id="run-title" className="text-xl font-semibold text-ink">
            Build the worker image
          </h2>
          <div className="mt-3 space-y-3">
            <CodeBlock
              wrap
              label="Build the worker"
              code={`docker build -f docker/worker-hosted.Dockerfile -t opencontext-worker .`}
            />
            <CodeBlock
              wrap
              label="Required runtime settings"
              code={`WORKER_API_URL=https://your-app.example
WORKER_API_TOKEN=<same secret as the web app>
WORKER_ID=oc-worker-prod-1
WORKER_CONCURRENCY=1
WORKER_SHUTDOWN_GRACE_SECONDS=120
WORKER_JOB_TIMEOUT_SECONDS=900
HF_HOME=/models`}
            />
          </div>
          <p className="mt-4">
            Mount a persistent volume at <code>/models</code>. Configure the host to restart the container on failure and give it at least 130 seconds to stop. The hosted image runs as UID 10001 and receives <code>SIGTERM</code> directly.
          </p>
        </section>

        <section aria-labelledby="lifecycle-title">
          <h2 id="lifecycle-title" className="text-xl font-semibold text-ink">
            Shutdown behavior
          </h2>
          <p className="mt-3">
            On <code>SIGTERM</code> or <code>SIGINT</code>, the supervisor stops making new claims and waits up to the configured grace period for current work. If work exceeds that period, the host terminates the process and the job lease expires for a later retry.
          </p>
          <p className="mt-3">
            The worker renews each claimed job&apos;s lease every minute. A
            process that disappears stops renewing; the queued job becomes
            available after the five-minute lease expires. Stage state and
            stored artifacts remain authoritative, and a resumed worker does
            not re-report completed stages. The current resume path can
            re-derive local stage inputs needed by downstream stages.
          </p>
          <p className="mt-3">
            A job that exceeds <code>WORKER_JOB_TIMEOUT_SECONDS</code> (900 seconds by default) is failed with a specific timeout. Set the container host&apos;s CPU and memory quotas to match the provider configuration; those quotas remain host policy.
          </p>
          <p className="mt-3">
            An idle worker reports a separate process heartbeat. The authenticated <code>/api/ops/alerts</code> check alerts when work is waiting without a recent worker, when the oldest queue entry or a running job crosses its threshold, and when a job recently ended as failed or partial. Set <code>OPS_API_TOKEN</code> on the web app and checker; the alert receiver gets aggregate state without media, prompts, or credentials.
          </p>
        </section>

        <section aria-labelledby="resources-title">
          <h2 id="resources-title" className="text-xl font-semibold text-ink">
            Input and runtime bounds
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">Bound</th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">Value</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Video duration", "30 minutes"],
                  ["Video", "500 MB"],
                  ["PDF", "50 MB, 30 pages"],
                  ["Image", "25 MB per image"],
                  ["Image-set job", "10 images"],
                  ["Provider 429 handling", "Model cooldown + fallback, then queue deferral"],
                  ["Provider-limited queue budget", "40 bounded attempts"],
                  ["Worker shutdown", "WORKER_SHUTDOWN_GRACE_SECONDS"],
                  ["Worker CPU / memory", "Set by the host container policy"],
                ].map(([label, value]) => (
                  <tr key={label} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-ink">{label}</td>
                    <td className="px-3 py-2">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="providers-title">
          <h2 id="providers-title" className="text-xl font-semibold text-ink">
            Provider configuration
          </h2>
          <div className="mt-3">
            <CodeBlock
              wrap
              label="Local transcription and provider"
              code={`TRANSCRIPTION_PROVIDER=faster_whisper
TRANSCRIPTION_MODEL=base
VISION_PROVIDER=openai_compatible
VISION_MODEL=<vision-capable model>
OCR_PROVIDER=vision
TEXT_PROVIDER=template
OPENAI_BASE_URL=<OpenAI-compatible base URL>
OPENAI_API_KEY=<provider key>`}
            />
          </div>
          <p className="mt-4">
            The worker supports Faster Whisper, OpenAI-compatible audio, and Ollama providers. Provider credentials stay on the worker host. See the{" "}
            <Link href="/docs/status" className="text-accent hover:underline">
              deployment status
            </Link>{" "}
            for what is currently verified.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
