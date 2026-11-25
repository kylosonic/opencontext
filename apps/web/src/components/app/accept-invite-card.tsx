"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/components/results/format";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type InviteInspectionView =
  | { status: "NOT_FOUND" }
  | { status: "REVOKED"; workspaceName: string }
  | { status: "ACCEPTED"; workspaceName: string }
  | { status: "EXPIRED"; workspaceName: string }
  | {
      status: "VALID";
      workspaceId: string;
      workspaceName: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "VIEWER";
      expiresAt: string;
    };

export function AcceptInviteCard({
  token,
  inspection,
  signedInEmail,
}: {
  token: string;
  inspection: InviteInspectionView;
  signedInEmail: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (inspection.status === "NOT_FOUND") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-ink">Invitation not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This team invitation link is invalid or no longer exists.
        </p>
        <ButtonLink href="/app/teams" variant="secondary" size="sm" className="mt-4">
          Back to Teams
        </ButtonLink>
      </Card>
    );
  }

  if (inspection.status !== "VALID") {
    const title =
      inspection.status === "REVOKED"
        ? "Invitation revoked"
        : inspection.status === "ACCEPTED"
          ? "Invitation already accepted"
          : "Invitation expired";
    return (
      <Card>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This invitation for{" "}
          <strong className="text-ink">{inspection.workspaceName}</strong> is no
          longer active. Ask a team owner or admin to issue a fresh link if you
          still need access.
        </p>
        <ButtonLink href="/app/teams" variant="secondary" size="sm" className="mt-4">
          Go to Teams
        </ButtonLink>
      </Card>
    );
  }

  const emailMismatch =
    signedInEmail !== null &&
    signedInEmail.trim().toLowerCase() !== inspection.email.trim().toLowerCase();

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Could not accept this invitation.",
        );
      }
      router.push("/app/teams");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not accept this invitation.",
      );
      setBusy(false);
    }
  }

  return (
    <Card aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="label-mono">Team invitation</p>
        <Badge tone="accent" mono>
          {inspection.role}
        </Badge>
      </div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
        Join {inspection.workspaceName}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Issued for <strong className="text-ink">{inspection.email}</strong> ·
        expires {formatDate(inspection.expiresAt)}.
      </p>
      {signedInEmail ? (
        <p className="mt-2 text-xs text-ink-faint">
          Signed in as <span className="font-mono text-ink">{signedInEmail}</span>.
        </p>
      ) : (
        <p className="mt-2 text-xs text-warn">
          Your current GitHub account does not expose a primary email matching{" "}
          {inspection.email}.
        </p>
      )}
      {emailMismatch && (
        <p role="alert" className="mt-3 text-sm text-err">
          Sign in with {inspection.email} to accept this invitation.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-err">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void accept()}
          disabled={busy || emailMismatch}
        >
          {busy ? "Joining…" : "Accept invitation"}
        </Button>
        <ButtonLink href="/app/teams" variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </Card>
  );
}
