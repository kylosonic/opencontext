import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Jobs API — OpenContext Docs",
  description:
    "Authenticated REST and SSE endpoints for uploads, URL imports, jobs, evidence review, team workspaces, public share links, and exports.",
};

const ENDPOINTS = [
  [
    "POST",
    "/api/uploads",
    "Create a direct-upload intent for supported media.",
  ],
  [
    "POST",
    "/api/uploads/multipart",
    "Initialize a resumable chunked/multipart upload session for large media.",
  ],
  [
    "PUT",
    "/api/uploads/[id]/chunks/[partNumber]",
    "Upload a single numbered chunk for an active resumable multipart upload.",
  ],
  [
    "GET",
    "/api/uploads/[id]/status",
    "Inspect uploaded chunk parts and byte progress to resume a transfer.",
  ],
  [
    "PUT",
    "signed object URL",
    "Upload bytes directly to configured object storage.",
  ],
  [
    "POST",
    "/api/uploads/[id]/complete",
    "Verify and finalize the object, creating a queued job.",
  ],
  [
    "POST",
    "/api/uploads/batch/complete",
    "Commit 2-10 uploaded images as one ordered image-set job.",
  ],
  [
    "POST",
    "/api/imports/url",
    "Validate and enqueue a job from a public HTTP(S) media URL.",
  ],
  [
    "GET",
    "/api/jobs",
    "List accessible personal or team jobs, newest first (filter via q, status, workspaceId, sourceKind).",
  ],
  ["GET", "/api/jobs/[id]", "Read a job's current state and stage progress."],
  [
    "PATCH",
    "/api/jobs/[id]",
    "Rename a job's display name (owner or team OWNER/ADMIN).",
  ],
  [
    "GET",
    "/api/jobs/[id]/events",
    "Stream live job status and progress updates over SSE.",
  ],
  [
    "POST",
    "/api/jobs/[id]/retry",
    "Retry an incomplete or transiently failed job.",
  ],
  [
    "POST",
    "/api/jobs/[id]/rerun",
    "Clone stored source media into a new queued job at a chosen detail level.",
  ],
  [
    "DELETE",
    "/api/jobs/[id]",
    "Delete a job owned or administered by the current user. Returns 204 on success.",
  ],
  [
    "GET",
    "/api/jobs/[id]/export?format=markdown",
    "Download the Markdown result for an accessible job.",
  ],
  [
    "GET",
    "/api/jobs/[id]/export?format=json",
    "Download the structured JSON result for an accessible job.",
  ],
  [
    "GET",
    "/api/jobs/[id]/source?asset=0&download=1",
    "Stream an authenticated inline preview or download the original source file.",
  ],
  [
    "PATCH",
    "/api/jobs/[id]/evidence/[evidenceId]",
    "Confirm or flag an evidence claim and save review notes.",
  ],
  [
    "GET / POST / DELETE",
    "/api/jobs/[id]/share",
    "Inspect, create, rotate, or revoke an expiring read-only public share link.",
  ],
  [
    "GET / POST",
    "/api/workspaces",
    "List team workspaces or create a new team workspace.",
  ],
  [
    "PATCH / DELETE",
    "/api/workspaces/[id]",
    "Rename a team workspace (owners/admins) or delete it (owner only).",
  ],
  [
    "GET / POST",
    "/api/workspaces/[id]/members",
    "List team members or add an existing OpenContext user as ADMIN, MEMBER, or VIEWER.",
  ],
  [
    "PATCH / DELETE",
    "/api/workspaces/[id]/members/[userId]",
    "Change a teammate's role or remove a member / leave a team.",
  ],
  [
    "GET / POST",
    "/api/workspaces/[id]/invites",
    "List pending invitations or create an expiring single-use email invite link.",
  ],
  [
    "GET / POST",
    "/api/workspaces/[id]/roles",
    "List or create custom workspace permission roles.",
  ],
  [
    "PATCH / DELETE",
    "/api/workspaces/[id]/roles/[roleId]",
    "Update or delete a custom workspace role.",
  ],
  [
    "GET / POST",
    "/api/workspaces/[id]/scim-tokens",
    "List or issue OWNER-scoped SCIM 2.0 provisioning bearer tokens.",
  ],
  [
    "DELETE",
    "/api/workspaces/[id]/scim-tokens/[tokenId]",
    "Revoke an active SCIM 2.0 provisioning bearer token.",
  ],
  [
    "GET / POST / PATCH / DELETE",
    "/api/scim/v2/Users & /Groups",
    "SCIM 2.0 directory sync endpoints authenticated via workspace SCIM bearer token.",
  ],
  [
    "DELETE",
    "/api/workspaces/[id]/invites/[inviteId]",
    "Revoke a pending team invitation.",
  ],
  [
    "GET / POST",
    "/api/invites/[token]",
    "Inspect an invitation or accept it for the signed-in verified email.",
  ],
  [
    "GET",
    "/api/usage",
    "Read completed analysis usage counts, duration, and recorded costs (workspaceId, days).",
  ],
  [
    "POST",
    "/api/worker/heartbeat",
    "Internal worker-token heartbeat for idle worker health (204).",
  ],
] as const;

export default function JobsApiPage() {
  return (
    <DocsShell
      kicker="API reference"
      title="Jobs API"
      description="Authenticated endpoints for uploads, URL imports, live job tracking, review, team workspaces, and sharing, plus the worker heartbeat interface."
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="contract-title">
          <h2 id="contract-title" className="text-xl font-semibold text-ink">
            Workflow
          </h2>
          <p className="mt-3">
            Create an upload intent, send the file to the returned upload URL,
            and complete the intent (or import a public URL), then subscribe to
            live SSE updates or poll the job. A worker claims queued work,
            processes it, and reports stage progress. User routes use the
            signed-in browser session; only worker and operations routes use
            service bearer tokens.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th
                    scope="col"
                    className="px-3 py-2 font-mono text-xs text-ink-faint"
                  >
                    Method
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 font-mono text-xs text-ink-faint"
                  >
                    Path
                  </th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, purpose]) => (
                  <tr
                    key={`${method}-${path}`}
                    className="border-b border-line align-top last:border-0"
                  >
                    <td className="px-3 py-3 font-mono text-xs text-ink">
                      {method}
                    </td>
                    <td className="break-all px-3 py-3 font-mono text-xs text-ink">
                      {path}
                    </td>
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
          <p className="mt-3">
            Call these endpoints from a signed-in browser session and include
            cookies with each request as shown below.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Read job status"
              code={`fetch("/api/jobs/job_123", { credentials: "include" })
  .then(async (response) => {
    if (!response.ok) throw new Error(\`Job request failed: \${response.status}\`);
    const job = await response.json();
    console.log(job.status);       // QUEUED, processing stages, COMPLETED, PARTIAL, or FAILED
    console.log(job.progress);     // 0-100
    console.log(job.stageStates);  // each stage's status, attempt, progress, and errors
  });`}
            />
          </div>
          <p className="mt-4">
            <code>JobDetail</code> also includes <code>errorStage</code>,{" "}
            <code>failureKind</code>, <code>retryAllowed</code>,{" "}
            <code>canManage</code>, source metadata, and{" "}
            <code>retentionNote</code>. Subscribe to{" "}
            <code>GET /api/jobs/[id]/events</code> (or poll every three seconds)
            and stop when <code>status</code> is <code>COMPLETED</code>,{" "}
            <code>PARTIAL</code>, or <code>FAILED</code>. The list endpoint
            returns the smaller <code>JobSummary</code> shape.
          </p>
        </section>

        <section aria-labelledby="upload-title">
          <h2 id="upload-title" className="text-xl font-semibold text-ink">
            Create an upload
          </h2>
          <p className="mt-3">
            Declare the filename, byte size, optional MIME type, and detail
            level. Use the returned URL, method, and headers for the transfer,
            then complete the intent. A single intent expires after 15 minutes.
          </p>
          <div className="mt-4 space-y-3">
            <CodeBlock
              wrap
              label="Create an upload intent"
              code={`const response = await fetch("/api/uploads", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    filename: "walkthrough.mp4",
    mime: file.type,
    sizeBytes: file.size,
    detailLevel: "MEDIUM",
  }),
});
if (!response.ok) throw new Error(\`Upload intent failed: \${response.status}\`);
const intent = await response.json(); // uploadId, method, url, headers, expiresAt`}
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
  credentials: "include",
});
if (!queued.ok) throw new Error(\`Upload completion failed: \${queued.status}\`);
const job = await queued.json();`}
            />
          </div>
          <p className="mt-4">
            On success, the complete route returns <code>201</code> and a{" "}
            <code>JobSummary</code>; the job is now <code>QUEUED</code>.
            Supported inputs and limits are listed in{" "}
            <Link href="/docs/uploads" className="text-accent hover:underline">
              Uploading media
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="batch-title">
          <h2 id="batch-title" className="text-xl font-semibold text-ink">
            Create an ordered image set
          </h2>
          <p className="mt-3">
            Create and transfer one intent for every image, preserving the
            intended order. Then commit all intents together. A set contains 2
            to 10 images and creates one job.
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Complete an image-set upload"
              code={`const response = await fetch("/api/uploads/batch/complete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    uploadIds: orderedUploadIds, // IDs from POST /api/uploads, in image order
    detailLevel: "MEDIUM",
  }),
});
if (!response.ok) throw new Error(\`Image set failed: \${response.status}\`);
const job = await response.json(); // JobSummary with one job ID`}
            />
          </div>
          <p className="mt-4">
            If one member is invalid, missing, or expired, the batch fails
            without creating a partial job. Use{" "}
            <code>DELETE /api/uploads/[id]</code> to cancel an unfinished or
            failed intent; a successful cancel returns <code>204</code>.
          </p>
        </section>

        <section aria-labelledby="manage-title">
          <h2 id="manage-title" className="text-xl font-semibold text-ink">
            Manage a job and its results
          </h2>
          <p className="mt-3">
            Retry keeps the same job and reuses stages that already succeeded. A
            retry returns the updated <code>JobDetail</code>. Deletion is
            permanent after confirmation and has no response body:
          </p>
          <div className="mt-4 space-y-3">
            <CodeBlock
              wrap
              label="Retry and delete"
              code={`const retried = await fetch("/api/jobs/job_123/retry", {
  method: "POST",
  credentials: "include",
});

const deleted = await fetch("/api/jobs/job_123", {
  method: "DELETE",
  credentials: "include",
});
if (deleted.status !== 204) throw new Error(\`Delete failed: \${deleted.status}\`);`}
            />
            <CodeBlock
              wrap
              label="Save an evidence review"
              code={`const updated = await fetch("/api/jobs/job_123/evidence/8", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    status: "FLAGGED",
    note: "The second button is disabled.",
    correctedText: "The secondary button is disabled.",
  }),
});
if (!updated.ok) throw new Error(\`Review failed: \${updated.status}\`);
const { markdown, json } = await updated.json();`}
            />
          </div>
          <p className="mt-4">
            Review status is <code>CONFIRMED</code>, <code>FLAGGED</code>, or{" "}
            <code>UNREVIEWED</code>. A correction, and a note, can be up to
            5,000 and 1,000 characters respectively. A suggested correction is
            allowed only on a flagged claim. Clearing a review requires{" "}
            <code>UNREVIEWED</code> with no note or correction.
          </p>
          <p className="mt-4">
            Image, PDF, and audio previews are available from{" "}
            <code>GET /api/jobs/[id]/source</code>. Use the zero-based{" "}
            <code>asset</code> query parameter to select an image in a set or a
            PDF page. Authenticated video playback uses a direct source URL
            instead of this preview route, while public share snapshots serve
            read-only source media through{" "}
            <code>GET /share/[token]/source</code>.
          </p>
        </section>

        <section aria-labelledby="errors-title">
          <h2 id="errors-title" className="text-xl font-semibold text-ink">
            Errors
          </h2>
          <p className="mt-3">
            Failures use a stable envelope. The full catalog lists every public
            code and HTTP status.
          </p>
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
            <Link
              href="/docs/api-errors"
              className="text-accent hover:underline"
            >
              View the API error catalog
            </Link>
          </p>
        </section>

        <section aria-labelledby="worker-title">
          <h2 id="worker-title" className="text-xl font-semibold text-ink">
            Worker heartbeat
          </h2>
          <p className="mt-3">
            The worker process uses its own internal API with{" "}
            <code>Authorization: Bearer &lt;WORKER_API_TOKEN&gt;</code>. The
            idle heartbeat does not accept a user session:
          </p>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Worker heartbeat request"
              code={`const heartbeat = await fetch("/api/worker/heartbeat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${process.env.WORKER_API_TOKEN}\`,
  },
  body: JSON.stringify({ workerId: "oc-worker-prod-1" }),
});
if (heartbeat.status !== 204) {
  throw new Error(\`Worker heartbeat rejected: \${heartbeat.status}\`);
}`}
            />
          </div>
        </section>
      </div>
    </DocsShell>
  );
}
