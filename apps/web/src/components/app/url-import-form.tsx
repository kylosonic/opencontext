"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface WorkspaceOption {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export function UrlImportForm({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [detailLevel, setDetailLevel] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/imports/url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          url,
          detailLevel,
          workspaceId: workspaceId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { id?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message ?? "Could not import the URL.");
      }
      router.push(`/app/jobs/${encodeURIComponent(payload.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import the URL.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Import from a public URL</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Public HTTP(S) media only. Private networks, credentials, custom
            ports, and responses without Content-Length are rejected. The
            provider must allow a server-side download.
          </p>
        </div>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/recording.mp4"
          aria-label="Public media URL"
          className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
          disabled={busy}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label-mono mb-1 block">Detail level</span>
            <select
              value={detailLevel}
              onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)}
              disabled={busy}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          {workspaces.length > 0 && (
            <label>
              <span className="label-mono mb-1 block">Destination</span>
              <select
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
              >
                <option value="">Personal workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? "Downloading and validating…" : "Import and analyze"}
        </Button>
      </form>
    </Card>
  );
}
