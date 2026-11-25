"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "@/components/results/copy-button";
import { formatDate } from "@/components/results/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface ScimTokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** OWNER-only workspace SCIM 2.0 provisioning token manager. */
export function WorkspaceScimPanel({ workspaceId }: { workspaceId: string }) {
  const [tokens, setTokens] = useState<ScimTokenRow[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{
    name: string;
    token: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/scim-tokens`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response?.ok) return [] as ScimTokenRow[];
        return (await response.json()) as ScimTokenRow[];
      })
      .then((rows) => {
        if (!cancelled) setTokens(rows);
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const scimEndpoint =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/scim/v2`
      : "/api/scim/v2";

  async function handleCreateToken(event: React.FormEvent) {
    event.preventDefault();
    if (!tokenName.trim() || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    setCreatedSecret(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/scim-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ name: tokenName.trim() }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        tokenRecord?: ScimTokenRow;
        token?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.tokenRecord || !payload.token) {
        throw new Error(payload?.error?.message ?? "Could not create SCIM token.");
      }
      setTokens((prev) => [payload.tokenRecord!, ...prev]);
      setCreatedSecret({ name: payload.tokenRecord.name, token: payload.token });
      setTokenName("");
      setMessage("SCIM token created — copy it now; it cannot be shown again.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create SCIM token.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeToken(tokenId: string) {
    if (revokingId) return;
    setRevokingId(tokenId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/scim-tokens/${encodeURIComponent(tokenId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "Could not revoke SCIM token.");
      }
      setTokens((prev) => prev.filter((item) => item.id !== tokenId));
      setMessage("SCIM token revoked.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not revoke SCIM token.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card aria-busy={creating || revokingId !== null}>
      <h2 className="text-base font-semibold text-ink">SCIM 2.0 directory sync</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Provision and deprovision workspace members automatically from Okta,
        Microsoft Entra ID, or any SCIM 2.0 identity provider.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="label-mono">SCIM base URL</span>
        <input
          type="text"
          readOnly
          value={scimEndpoint}
          aria-label="SCIM base URL"
          className="min-w-60 flex-1 rounded-md border border-line bg-panel-muted px-3 py-1.5 font-mono text-xs text-ink"
        />
        <CopyButton value={scimEndpoint} label="Copy SCIM URL" />
      </div>

      <form
        onSubmit={(event) => void handleCreateToken(event)}
        className="mt-4 flex flex-wrap gap-2"
      >
        <input
          value={tokenName}
          onChange={(event) => setTokenName(event.target.value)}
          maxLength={80}
          placeholder="Okta production sync"
          aria-label="SCIM token name"
          disabled={creating}
          className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
        />
        <Button type="submit" disabled={creating || !tokenName.trim()}>
          {creating ? "Generating…" : "Generate SCIM token"}
        </Button>
      </form>

      {createdSecret && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs font-medium text-ink">
            Bearer token for {createdSecret.name} (shown once)
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={createdSecret.token}
              aria-label="Generated SCIM token"
              className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-xs text-ink"
            />
            <CopyButton value={createdSecret.token} label="Copy SCIM token" />
          </div>
        </div>
      )}

      {tokens.length > 0 ? (
        <ul className="mt-4 divide-y divide-line">
          {tokens.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
            >
              <span className="font-medium text-ink">{item.name}</span>
              <Badge tone="neutral" mono>
                {item.prefix}…
              </Badge>
              <span className="text-xs text-ink-faint">
                {item.lastUsedAt
                  ? `Last used ${formatDate(item.lastUsedAt)}`
                  : "Never used"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="danger-ghost"
                className="ml-auto"
                disabled={revokingId === item.id}
                onClick={() => void handleRevokeToken(item.id)}
              >
                {revokingId === item.id ? "Revoking…" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">
          No active SCIM tokens for this team.
        </p>
      )}

      {message && (
        <p role="status" className="mt-3 text-sm text-ok">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-err">
          {error}
        </p>
      )}
    </Card>
  );
}
