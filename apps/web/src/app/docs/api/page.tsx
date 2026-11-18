import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Jobs API - OpenContext docs",
};

const ENDPOINTS = [
  ["POST", "/api/uploads", "Create a direct-upload intent for supported media."],
  ["PUT", "signed object URL", "Upload bytes directly to configured object storage."],
  ["POST", "/api/uploads/[id]/complete", "Verify and finalize the object, creating a queued job."],
  ["GET", "/api/jobs", "List the current owner's jobs, newest first."],
  ["GET", "/api/jobs/[id]", "Read a job's current state and stage progress."],
  ["POST", "/api/jobs/[id]/retry", "Retry an incomplete or transiently failed job."],
  ["GET", "/api/jobs/[id]/export?format=markdown", "Download the owner's Markdown result."],
  ["GET", "/api/jobs/[id]/export?format=json", "Download the owner's structured result."],
] as const;

export default function JobsApiPage() {
  return (
    <DocsShell
      kicker="API reference"
      title="Jobs API"
      description="Owner-authenticated endpoints for the upload-to-context workflow. All processing endpoints require a signed-in job owner."
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="contract-title">
          <h2 id="contract-title" className="text-xl font-semibold text-ink">
            Workflow
          </h2>
          <p className="mt-3">
            Create an upload intent, send the file directly to object storage, complete the intent, then poll the job. A background worker claims queued work and runs the five processing stages.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-3 py-2 font-mono text-xs text-ink-faint">Method</th>
                  <th scope="col" className="px-3 py-2 font-mono text-xs text-ink-faint">Path</th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, purpose]) => (
                  <tr key={`${method}-${path}`} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-3 font-mono text-xs text-ink">{method}</td>
                    <td className="break-all px-3 py-3 font-mono text-xs text-ink">{path}</td>
                    <td className="px-3 py-3">{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="example-title">
          <h2 id="example-title" className="text-xl font-semibold text-ink">
            Read a job
          </h2>
          <p className="mt-3">Call these endpoints from a signed-in browser session. Authentication cookies are required.</p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Read job status"
              code={`fetch("/api/jobs/job_123", { credentials: "include" })
  .then((response) => response.json())
  .then((job) => {
    console.log(job.status);             // QUEUED, PROCESSING, COMPLETED...
    console.log(job.stageStates);        // per-stage status and attempts
  });`}
            />
          </div>
        </section>

        <section aria-labelledby="upload-title">
          <h2 id="upload-title" className="text-xl font-semibold text-ink">
            Create an upload
          </h2>
          <p className="mt-3">
            Declare the filename, byte size, and optional MIME type first. Use the returned URL and headers for the PUT, then complete the upload. A single intent expires after 15 minutes.
          </p>
          <div className="mt-4 space-y-3">
            <CodeBlock
              wrap
              label="Create an upload intent"
              code={`const response = await fetch("/api/uploads", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filename: "walkthrough.mp4",
    mime: file.type,
    sizeBytes: file.size,
  }),
});
const intent = await response.json();`}
            />
            <CodeBlock
              wrap
              label="Upload and queue the job"
              code={`await fetch(intent.url, {
  method: intent.method,
  headers: intent.headers,
  body: file,
});

const queued = await fetch(\`/api/uploads/\${intent.uploadId}/complete\`, {
  method: "POST",
});
const job = await queued.json();`}
            />
          </div>
          <p className="mt-4">
            Use <code>POST /api/uploads/batch/complete</code> with ordered <code>uploadIds</code> for an image set containing 2 to 10 images.
          </p>
        </section>

        <section aria-labelledby="errors-title">
          <h2 id="errors-title" className="text-xl font-semibold text-ink">
            Errors
          </h2>
          <p className="mt-3">Failures use a stable envelope. The full catalog lists every public code and HTTP status.</p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Error response"
              code={`{
  "error": {
    "code": "FORBIDDEN",
    "message": "You don't have access to this job"
  }
}`}
            />
          </div>
          <p className="mt-4">
            <Link href="/docs/api-errors" className="text-accent hover:underline">
              View the API error catalog
            </Link>
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
