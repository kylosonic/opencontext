"use client";

import { useEffect, useState } from "react";
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

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function WorkspaceManager({ initial }: { initial: WorkspaceRow[] }) {
  const [workspaces, setWorkspaces] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.id ?? null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(Boolean(initial[0]?.id));
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [memberRole, setMemberRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const current = workspaces.find((workspace) => workspace.id === selected);
  const canManage = current?.role === "OWNER" || current?.role === "ADMIN";

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void fetch(`/api/workspaces/${encodeURIComponent(selected)}/members`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("fetch failed");
        return (await response.json()) as MemberRow[];
      })
      .then((rows) => {
        if (cancelled) return;
        setMembers(rows);
        setMemberError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setMemberError("Could not load team members.");
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, reloadNonce]);

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === selected) {
      setLoadingMembers(true);
      setMemberMessage(null);
      setMemberError(null);
      setReloadNonce((n) => n + 1);
      return;
    }
    setMembers([]);
    setLoadingMembers(true);
    setMemberMessage(null);
    setMemberError(null);
    setSelected(workspaceId);
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || creatingTeam) return;
    setCreatingTeam(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
      setMembers([]);
      setLoadingMembers(true);
      setMemberMessage(null);
      setMemberError(null);
      setSelected(payload.id);
      setCreateMessage(`${payload.name} created. Add an existing OpenContext user below.`);
    } catch (caught) {
      setCreateError(
        caught instanceof Error ? caught.message : "Could not create the team.",
      );
    } finally {
      setCreatingTeam(false);
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !identifier.trim() || addingMember) return;
    setAddingMember(true);
    setMemberError(null);
    setMemberMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
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
      setLoadingMembers(true);
      setReloadNonce((n) => n + 1);
      setWorkspaces((rows) =>
        rows.map((workspace) =>
          workspace.id === selected
            ? { ...workspace, memberCount: workspace.memberCount + 1 }
            : workspace,
        ),
      );
      setMemberMessage("Team member added.");
    } catch (caught) {
      setMemberError(
        caught instanceof Error ? caught.message : "Could not add the member.",
      );
    } finally {
      setAddingMember(false);
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
        <form
          onSubmit={(event) => void createTeam(event)}
          className="mt-4 flex flex-wrap gap-2"
          aria-busy={creatingTeam}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Product research"
            aria-label="Team name"
            disabled={creatingTeam}
            className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
          />
          <Button type="submit" disabled={creatingTeam || !name.trim()}>
            {creatingTeam ? "Creating…" : "Create team"}
          </Button>
        </form>
        {createMessage && (
          <p role="status" className="mt-3 text-sm text-ok">
            {createMessage}
          </p>
        )}
        {createError && (
          <p role="alert" className="mt-3 text-sm text-err">
            {createError}
          </p>
        )}
      </Card>

      {workspaces.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-ink">Your teams</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {workspaces.map((workspace) => {
              const isSelected = selected === workspace.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectWorkspace(workspace.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    isSelected
                      ? "border-accent bg-accent/5"
                      : "border-line hover:bg-panel-muted"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{workspace.name}</span>
                    <Badge tone="neutral" mono>{workspace.role}</Badge>
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {pluralize(workspace.memberCount, "member")} ·{" "}
                    {pluralize(workspace.jobCount, "job")}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {current && (
        <Card aria-busy={loadingMembers || addingMember}>
          <h2 className="text-base font-semibold text-ink">{current.name} members</h2>
          {canManage && (
            <form
              onSubmit={(event) => void addMember(event)}
              className="mt-4 flex flex-wrap gap-2"
            >
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Email or GitHub login"
                aria-label="Member email or GitHub login"
                disabled={addingMember}
                className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
              />
              <select
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as "ADMIN" | "MEMBER")}
                aria-label="Member role"
                disabled={addingMember}
                className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
              <Button type="submit" disabled={addingMember || !identifier.trim()}>
                {addingMember ? "Adding…" : "Add existing user"}
              </Button>
            </form>
          )}
          {loadingMembers && members.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">Loading team members…</p>
          ) : members.length > 0 ? (
            <ul className="mt-4 divide-y divide-line">
              {members.map((member) => {
                const primary =
                  member.name ??
                  member.githubLogin ??
                  member.email ??
                  member.userId;
                const secondary =
                  member.email ??
                  (member.githubLogin && member.githubLogin !== primary
                    ? `@${member.githubLogin}`
                    : null);
                return (
                  <li
                    key={member.userId}
                    className="flex flex-wrap items-center gap-3 py-3 text-sm"
                  >
                    <span className="font-medium text-ink">{primary}</span>
                    {secondary && (
                      <span className="text-ink-faint">{secondary}</span>
                    )}
                    <Badge tone="neutral" mono className="ml-auto">
                      {member.role}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              No members returned for this team.
            </p>
          )}
          {memberMessage && (
            <p role="status" className="mt-3 text-sm text-ok">
              {memberMessage}
            </p>
          )}
          {memberError && (
            <p role="alert" className="mt-3 text-sm text-err">
              {memberError}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
