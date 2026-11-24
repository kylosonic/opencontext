"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface WorkspaceRow {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  memberCount: number;
  jobCount: number;
}

interface MemberRow {
  userId: string;
  name: string | null;
  email: string | null;
  githubLogin: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export function WorkspaceManager({ initial }: { initial: WorkspaceRow[] }) {
  const [workspaces, setWorkspaces] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.id ?? null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [memberRole, setMemberRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = workspaces.find((workspace) => workspace.id === selected);
  const canManage = current?.role === "OWNER" || current?.role === "ADMIN";

  async function loadMembers(workspaceId: string) {
    setSelected(workspaceId);
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
    if (!response.ok) {
      setMembers([]);
      setError("Could not load team members.");
      return;
    }
    setMembers((await response.json()) as MemberRow[]);
  }

  async function createTeam() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (WorkspaceRow & { error?: { message?: string } })
        | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message ?? "Could not create the team.");
      }
      setWorkspaces((rows) => [...rows, payload]);
      setName("");
      setSelected(payload.id);
      setMembers([]);
      setMessage(`${payload.name} created. Add an existing OpenContext user below.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the team.");
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!selected || !identifier.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, role: memberRole }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not add the member.");
      }
      setIdentifier("");
      await loadMembers(selected);
      setWorkspaces((rows) =>
        rows.map((workspace) =>
          workspace.id === selected
            ? { ...workspace, memberCount: workspace.memberCount + 1 }
            : workspace,
        ),
      );
      setMessage("Team member added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-semibold text-ink">Create a team</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Team members see every analysis uploaded to the team. Owners and
          admins can manage jobs and add members.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Product research"
            aria-label="Team name"
            className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
          />
          <Button onClick={() => void createTeam()} disabled={busy || !name.trim()}>
            {busy ? "Working…" : "Create team"}
          </Button>
        </div>
      </Card>

      {workspaces.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-ink">Your teams</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => void loadMembers(workspace.id)}
                className={`rounded-lg border p-4 text-left ${
                  selected === workspace.id ? "border-accent bg-accent/5" : "border-line"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{workspace.name}</span>
                  <Badge tone="neutral" mono>{workspace.role}</Badge>
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {workspace.memberCount} members · {workspace.jobCount} jobs
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {current && (
        <Card>
          <h2 className="text-base font-semibold text-ink">{current.name} members</h2>
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Email or GitHub login"
                aria-label="Member email or GitHub login"
                className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
              />
              <select
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as "ADMIN" | "MEMBER")}
                aria-label="Member role"
                className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
              <Button onClick={() => void addMember()} disabled={busy || !identifier.trim()}>
                Add existing user
              </Button>
            </div>
          )}
          {members.length > 0 ? (
            <ul className="mt-4 divide-y divide-line">
              {members.map((member) => (
                <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="font-medium text-ink">
                    {member.name ?? member.githubLogin ?? member.email ?? member.userId}
                  </span>
                  <span className="text-ink-faint">{member.email}</span>
                  <Badge tone="neutral" mono className="ml-auto">{member.role}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              Select the team again to load its members.
            </p>
          )}
          {message && <p role="status" className="mt-3 text-sm text-ok">{message}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-err">{error}</p>}
        </Card>
      )}
    </div>
  );
}
