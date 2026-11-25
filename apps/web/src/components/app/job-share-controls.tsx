"use client";

import { useEffect, useState } from "react";
import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { CopyButton } from "@/components/results/copy-button";
import { formatDate } from "@/components/results/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ManageCardProps {
  jobId: string;
  shareable: boolean;
  onDelete: () => void;
  error?: string | null;
  displayName?: string;
  onRename?: (nextName: string) => Promise<void>;
  detailLevel?: DetailLevel;
  onRerun?: (detailLevel: DetailLevel) => Promise<void>;
}

/** Job management panel hosting rename, re-run, delete, and public-share controls. */
export function ManageCard({
  jobId,
  shareable,
  onDelete,
  error = null,
  displayName,
  onRename,
  detailLevel,
  onRerun,
}: ManageCardProps) {
  const [nameDraft, setNameDraft] = useState(displayName ?? "");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [rerunLevel, setRerunLevel] = useState<DetailLevel>(detailLevel ?? "HIGH");
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (!onRename || !nameDraft.trim() || renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    setRenameMessage(null);
    try {
      await onRename(nameDraft.trim());
      setRenameMessage("Job name updated.");
    } catch (caught) {
      setRenameError(
        caught instanceof Error ? caught.message : "Could not rename the job.",
      );
    } finally {
      setRenameBusy(false);
    }
  }

  async function submitRerun(event: React.FormEvent) {
    event.preventDefault();
    if (!onRerun || rerunBusy) return;
    setRerunBusy(true);
    setRerunError(null);
    try {
      await onRerun(rerunLevel);
    } catch (caught) {
      setRerunError(
        caught instanceof Error ? caught.message : "Could not queue a re-run.",
      );
      setRerunBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Manage job</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="danger-ghost" size="sm" onClick={onDelete}>
          Delete job
        </Button>
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
      </div>

      {onRename && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Rename job</h3>
          <form
            onSubmit={(event) => void submitRename(event)}
            className="mt-2 flex flex-wrap items-center gap-2"
            aria-busy={renameBusy}
          >
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              maxLength={200}
              aria-label="Job display name"
              disabled={renameBusy}
              className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-ink"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={
                renameBusy ||
                !nameDraft.trim() ||
                nameDraft.trim() === displayName
              }
            >
              {renameBusy ? "Saving…" : "Save name"}
            </Button>
          </form>
          {renameMessage && (
            <p role="status" className="mt-2 text-xs text-ok">
              {renameMessage}
            </p>
          )}
          {renameError && (
            <p role="alert" className="mt-2 text-xs text-err">
              {renameError}
            </p>
          )}
        </div>
      )}

      {onRerun && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">
            Re-run at another detail level
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Creates a new queued job from the stored source media while keeping
            this result intact.
          </p>
          <form
            onSubmit={(event) => void submitRerun(event)}
            className="mt-3 flex flex-wrap items-center gap-2"
            aria-busy={rerunBusy}
          >
            <select
              value={rerunLevel}
              onChange={(event) =>
                setRerunLevel(event.target.value as DetailLevel)
              }
              aria-label="Detail level for re-run"
              disabled={rerunBusy}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-ink"
            >
              <option value="LOW">Low — quick overview</option>
              <option value="MEDIUM">Medium — UI, OCR, interactions</option>
              <option value="HIGH">High — granular detail</option>
            </select>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={rerunBusy}
            >
              {rerunBusy ? "Queueing…" : "Queue re-run"}
            </Button>
          </form>
          {rerunError && (
            <p role="alert" className="mt-2 text-xs text-err">
              {rerunError}
            </p>
          )}
        </div>
      )}

      {shareable && <ShareControls jobId={jobId} />}
    </Card>
  );
}

function ShareControls({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return (await response.json()) as { active?: boolean; expiresAt?: string };
      })
      .then((status) => {
        if (cancelled) return;
        setActive(Boolean(status.active));
        setExpiresAt(status.expiresAt ?? null);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the public-link status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function createLink() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; expiresAt?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error?.message ?? "Could not create the share link.");
      }
      const absolute = new URL(payload.url, window.location.origin).href;
      setPublicUrl(absolute);
      setActive(true);
      setExpiresAt(payload.expiresAt ?? null);
      let copied = false;
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(absolute);
          copied = true;
        } catch {
          copied = false;
        }
      }
      setMessage(
        copied
          ? "Read-only link created and copied."
          : "Read-only link created — copy it below.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/share`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Could not revoke the share link.");
      setActive(false);
      setPublicUrl(null);
      setExpiresAt(null);
      setMessage("Public access revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4" aria-busy={loading || busy}>
      <h3 className="text-sm font-semibold text-ink">Public share</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Anyone with the link can view the results and source media in read-only
        mode. Creating a new link revokes the previous one. Links expire after
        30 days.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void createLink()}
          disabled={loading || busy}
        >
          {loading
            ? "Checking link…"
            : busy
              ? "Working…"
              : active
                ? "Rotate share link"
                : "Create share link"}
        </Button>
        {active && (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={() => void revokeLink()}
            disabled={loading || busy}
          >
            Stop sharing
          </Button>
        )}
      </div>
      {publicUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            readOnly
            value={publicUrl}
            aria-label="Public share link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-56 flex-1 rounded-md border border-line bg-panel-muted px-3 py-1.5 font-mono text-xs text-ink"
          />
          <CopyButton value={publicUrl} label="Copy link" />
        </div>
      )}
      {active && expiresAt && (
        <p className="mt-2 text-xs text-ink-faint">
          Active until {formatDate(expiresAt)}.
        </p>
      )}
      {message && <p role="status" className="mt-2 text-xs text-ok">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
    </div>
  );
}
