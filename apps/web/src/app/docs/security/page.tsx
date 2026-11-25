import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Security & retention — OpenContext Docs",
  description:
    "How GitHub authentication, team role access, public share tokens, media verification, and automatic data retention work.",
};

export default function SecurityPage() {
  return (
    <DocsShell
      kicker="Operations"
      title="Security & retention"
      description="How signed-in access, media transfer, review notes, and automatic cleanup work in the hosted preview."
      accessory={
        <Badge tone="neutral" mono>
          Working preview
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="access-title">
          <h2 id="access-title" className="text-xl font-semibold text-ink">
            Accounts and access
          </h2>
          <p className="mt-3">
            The hosted app supports GitHub OAuth, Google OAuth, and generic
            Enterprise OIDC SSO (<code>AUTH_GOOGLE_*</code>,{" "}
            <code>AUTH_OIDC_*</code>). User job routes use the signed-in session
            and return resources owned by the current user or accessible through
            their team workspace memberships (Owners, Admins, Members, Viewers,
            plus per-workspace custom permission roles). Workspace owners can
            also issue hashed SCIM 2.0 bearer tokens for automated user and group
            provisioning at <code>/api/scim/v2</code>. Email invitations store
            SHA-256 token hashes with a configurable TTL (
            <code>WORKSPACE_INVITE_TTL_HOURS</code>, default 7 days) and accept
            only when the signed-in verified email matches. Explicit expiring
            public share links grant read-only snapshot access without sign-in
            until revoked.
          </p>
        </section>

        <section aria-labelledby="storage-title">
          <h2 id="storage-title" className="text-xl font-semibold text-ink">
            Media and storage
          </h2>
          <p className="mt-3">
            The browser transfers source bytes through short-lived upload URLs.
            In production, those writes go to object storage; locally, the app
            serves a session-authenticated disk upload endpoint. OpenContext
            verifies the stored object&apos;s size, media type, and required
            file signature before queueing it.
          </p>
          <p className="mt-3">
            Media preview requests are authenticated for the job owner or team
            members (or authorized via an active public share token). The worker
            downloads the source to process it and uses configured model
            providers for transcription, vision, OCR, or optional text
            refinement. The provider path and its credentials are deployment
            configuration; the local CLI can use local providers.
          </p>
        </section>

        <section aria-labelledby="retention-title">
          <h2 id="retention-title" className="text-xl font-semibold text-ink">
            Retention and removal
          </h2>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {[
              [
                "Completed job",
                "14 days by default",
                "Source media, intermediate artifacts, results, and exports available from that job.",
              ],
              [
                "Incomplete job",
                "7 days by default",
                "Unfinished job and its stored artifacts.",
              ],
              [
                "Abandoned upload",
                "15 minutes",
                "Uncommitted upload intent; temporary objects are removed by the retention sweep.",
              ],
              [
                "Manual deletion",
                "Immediate",
                "After owner or team-admin confirmation, the job disappears from listings and its URL no longer exposes it.",
              ],
            ].map(([item, period, detail]) => (
              <div
                key={item}
                className="grid gap-1 py-4 sm:grid-cols-[9rem_7rem_minmax(0,1fr)] sm:gap-4"
              >
                <h3 className="font-medium text-ink">{item}</h3>
                <p className="text-ink">{period}</p>
                <p>{detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-4">
            Deployment operators can set separate positive retention windows with{" "}
            <code>RETENTION_COMPLETED_DAYS</code> and{" "}
            <code>RETENTION_INCOMPLETE_DAYS</code>.{" "}
            Results downloaded or copied elsewhere remain under your own storage
            and access controls. The retention window is shown on each job page.
          </p>
        </section>

        <section aria-labelledby="notes-title">
          <h2 id="notes-title" className="text-xl font-semibold text-ink">
            Evidence review data
          </h2>
          <p className="mt-3">
            A review can contain a note of up to 1,000 characters and a
            suggested correction of up to 5,000 characters. Suggested
            corrections can be attached only to a flagged claim. Reviews are
            stored with the result, included in Markdown and JSON exports, and
            removed when the job is deleted or expires.
          </p>
        </section>

        <section aria-labelledby="limits-title">
          <h2 id="limits-title" className="text-xl font-semibold text-ink">
            Preview boundaries
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The hosted provider configuration is not a guarantee that media
              never leaves a particular machine; local CLI processing is the
              path for local model execution.
            </li>
            <li>
              The current verification does not include an independent
              penetration test or sustained high-traffic security evidence.
            </li>
            <li>
              Public share links grant read-only snapshot access to anyone with
              the token URL until the link expires or is revoked by an owner or
              team admin.
            </li>
            <li>
              Operations alert webhooks can be authenticated using optional HMAC-SHA256
              signatures (<code>X-OpenContext-Timestamp</code> and{" "}
              <code>X-OpenContext-Signature</code> via{" "}
              <code>ALERT_WEBHOOK_SECRET</code>).
            </li>
          </ul>
          <p className="mt-4">
            Read{" "}
            <Link href="/docs/status" className="text-accent hover:underline">
              status and limits
            </Link>{" "}
            before using the preview for sensitive or critical material.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
