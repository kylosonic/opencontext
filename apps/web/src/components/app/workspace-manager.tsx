"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { CopyButton } from "@/components/results/copy-button";
import { formatDate } from "@/components/results/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
type AssignableRole = "ADMIN" | "MEMBER" | "VIEWER";

interface WorkspaceRow {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  jobCount: number;
}

interface MemberRow {
  userId: string;
  name: string | null;
  email: string | null;
  githubLogin: string | null;
  role: WorkspaceRole;
}

interface InviteRow {
  id: string;
  email: string;
  role: AssignableRole;
  expiresAt: string;
  createdAt: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function WorkspaceManager({
  initial,
  currentUserId,
}: {
  initial: WorkspaceRow[];
  currentUserId?: string;
}) {
  const [workspaces, setWorkspaces] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.id ?? null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(Boolean(initial[0]?.id));
  const [name, setName] = useState("");
  const [renameValue, setRenameValue] = useState(initial[0]?.name ?? "");
  const [identifier, setIdentifier] = useState("");
  const [memberRole, setMemberRole] = useState<AssignableRole>("MEMBER");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("MEMBER");
  const [latestInvite, setLatestInvite] = useState<{
    email: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [renamingTeam, setRenamingTeam] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [teamActionMessage, setTeamActionMessage] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const current = workspaces.find((workspace) => workspace.id === selected);
  const canManage = current?.role === "OWNER" || current?.role === "ADMIN";
  const isOwner = current?.role === "OWNER";

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

    if (canManage) {
      void fetch(`/api/workspaces/${encodeURIComponent(selected)}/invites`, {
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) return [] as InviteRow[];
          return (await response.json()) as InviteRow[];
        })
        .then((rows) => {
          if (!cancelled) setInvites(rows);
        })
        .catch(() => {
          if (!cancelled) setInvites([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selected, reloadNonce, canManage]);

  function selectWorkspace(workspace: WorkspaceRow) {
    if (workspace.id === selected) {
      setLoadingMembers(true);
      setMemberMessage(null);
      setMemberError(null);
      setReloadNonce((n) => n + 1);
      return;
    }
    setMembers([]);
    setInvites([]);
    setLatestInvite(null);
    setLoadingMembers(true);
    setRenameValue(workspace.name);
    setTeamActionMessage(null);
    setTeamActionError(null);
    setMemberMessage(null);
    setMemberError(null);
    setInviteMessage(null);
    setInviteError(null);
    setSelected(workspace.id);
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
      setInvites([]);
      setLatestInvite(null);
      setRenameValue(payload.name);
      setLoadingMembers(true);
      setTeamActionMessage(null);
      setTeamActionError(null);
      setMemberMessage(null);
      setMemberError(null);
      setInviteMessage(null);
      setInviteError(null);
      setSelected(payload.id);
      setCreateMessage(`${payload.name} created. Add or invite teammates below.`);
    } catch (caught) {
      setCreateError(
        caught instanceof Error ? caught.message : "Could not create the team.",
      );
    } finally {
      setCreatingTeam(false);
    }
  }

  async function renameTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !renameValue.trim() || renamingTeam) return;
    setRenamingTeam(true);
    setTeamActionError(null);
    setTeamActionMessage(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(selected)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: renameValue }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (WorkspaceRow & { error?: { message?: string } })
        | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message ?? "Could not rename the team.");
      }
      setWorkspaces((rows) =>
        rows.map((workspace) =>
          workspace.id === selected ? { ...workspace, name: payload.name } : workspace,
        ),
      );
      setRenameValue(payload.name);
      setTeamActionMessage("Team name updated.");
    } catch (caught) {
      setTeamActionError(
        caught instanceof Error ? caught.message : "Could not rename the team.",
      );
    } finally {
      setRenamingTeam(false);
    }
  }

  async function confirmDeleteTeam() {
    if (!selected || deletingTeam) return;
    setDeletingTeam(true);
    setTeamActionError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(selected)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "Could not delete the team.");
      }
      const remaining = workspaces.filter((workspace) => workspace.id !== selected);
      setWorkspaces(remaining);
      setDeleteDialogOpen(false);
      setMembers([]);
      setInvites([]);
      setLatestInvite(null);
      setSelected(remaining[0]?.id ?? null);
      setRenameValue(remaining[0]?.name ?? "");
      setLoadingMembers(Boolean(remaining[0]?.id));
    } catch (caught) {
      setTeamActionError(
        caught instanceof Error ? caught.message : "Could not delete the team.",
      );
      setDeleteDialogOpen(false);
    } finally {
      setDeletingTeam(false);
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

  async function changeMemberRole(userId: string, nextRole: WorkspaceRole) {
    if (!selected || busyMemberId) return;
    setBusyMemberId(userId);
    setMemberError(null);
    setMemberMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/members/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        role?: WorkspaceRole;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not update role.");
      }
      setMembers((rows) =>
        rows.map((member) =>
          member.userId === userId ? { ...member, role: nextRole } : member,
        ),
      );
      setMemberMessage("Member role updated.");
    } catch (caught) {
      setMemberError(
        caught instanceof Error ? caught.message : "Could not update role.",
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(userId: string, isSelf: boolean) {
    if (!selected || busyMemberId) return;
    setBusyMemberId(userId);
    setMemberError(null);
    setMemberMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/members/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ??
            (isSelf ? "Could not leave the team." : "Could not remove member."),
        );
      }
      if (isSelf) {
        const remaining = workspaces.filter((workspace) => workspace.id !== selected);
        setWorkspaces(remaining);
        setMembers([]);
        setInvites([]);
        setSelected(remaining[0]?.id ?? null);
        setRenameValue(remaining[0]?.name ?? "");
        setLoadingMembers(Boolean(remaining[0]?.id));
        return;
      }
      setMembers((rows) => rows.filter((member) => member.userId !== userId));
      setWorkspaces((rows) =>
        rows.map((workspace) =>
          workspace.id === selected
            ? { ...workspace, memberCount: Math.max(0, workspace.memberCount - 1) }
            : workspace,
        ),
      );
      setMemberMessage("Member removed.");
    } catch (caught) {
      setMemberError(
        caught instanceof Error
          ? caught.message
          : isSelf
            ? "Could not leave the team."
            : "Could not remove member.",
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !inviteEmail.trim() || creatingInvite) return;
    setCreatingInvite(true);
    setInviteError(null);
    setInviteMessage(null);
    setLatestInvite(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        invite?: InviteRow;
        url?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.invite || !payload.url) {
        throw new Error(payload?.error?.message ?? "Could not create invite.");
      }
      const absoluteUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${payload.url}`
          : payload.url;
      setInviteEmail("");
      setLatestInvite({
        email: payload.invite.email,
        url: absoluteUrl,
        expiresAt: payload.invite.expiresAt,
      });
      setInvites((rows) => [
        payload.invite!,
        ...rows.filter((row) => row.email !== payload.invite!.email),
      ]);
      setInviteMessage(
        "Invite link created — copy and share it securely with the recipient.",
      );
    } catch (caught) {
      setInviteError(
        caught instanceof Error ? caught.message : "Could not create invite.",
      );
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!selected || busyInviteId) return;
    setBusyInviteId(inviteId);
    setInviteError(null);
    setInviteMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(selected)}/invites/${encodeURIComponent(inviteId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "Could not revoke invite.");
      }
      setInvites((rows) => rows.filter((row) => row.id !== inviteId));
      setInviteMessage("Invitation revoked.");
    } catch (caught) {
      setInviteError(
        caught instanceof Error ? caught.message : "Could not revoke invite.",
      );
    } finally {
      setBusyInviteId(null);
    }
  }

  function editableRoleChoices(targetRole: WorkspaceRole): WorkspaceRole[] | null {
    if (!canManage) return null;
    if (isOwner) return ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
    if (targetRole === "OWNER" || targetRole === "ADMIN") return null;
    return ["MEMBER", "VIEWER"];
  }

  function canRemoveMember(member: MemberRow): boolean {
    if (currentUserId && member.userId === currentUserId) return true;
    if (isOwner) return true;
    if (canManage && (member.role === "MEMBER" || member.role === "VIEWER")) {
      return true;
    }
    return false;
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-semibold text-ink">Create a team</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Team members see every analysis uploaded to the team. Owners and
          admins can manage jobs and members, while viewers have read-only access.
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
                  onClick={() => selectWorkspace(workspace)}
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
        <>
          {canManage && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">Team settings</h2>
                {isOwner && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger-ghost"
                    disabled={deletingTeam}
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    Delete team
                  </Button>
                )}
              </div>
              <form
                onSubmit={(event) => void renameTeam(event)}
                className="mt-3 flex flex-wrap gap-2"
                aria-busy={renamingTeam}
              >
                <input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  maxLength={80}
                  aria-label="Rename team"
                  disabled={renamingTeam}
                  className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={
                    renamingTeam ||
                    !renameValue.trim() ||
                    renameValue.trim() === current.name
                  }
                >
                  {renamingTeam ? "Saving…" : "Rename team"}
                </Button>
              </form>
              {teamActionMessage && (
                <p role="status" className="mt-3 text-sm text-ok">
                  {teamActionMessage}
                </p>
              )}
              {teamActionError && (
                <p role="alert" className="mt-3 text-sm text-err">
                  {teamActionError}
                </p>
              )}
            </Card>
          )}

          <Card aria-busy={loadingMembers || addingMember || busyMemberId !== null}>
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
                  onChange={(event) =>
                    setMemberRole(event.target.value as AssignableRole)
                  }
                  aria-label="Member role"
                  disabled={addingMember}
                  className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                  <option value="VIEWER">Viewer</option>
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
                  const roleChoices = editableRoleChoices(member.role);
                  const isSelf = currentUserId === member.userId;
                  const removable = canRemoveMember(member);
                  const busy = busyMemberId === member.userId;
                  return (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center gap-3 py-3 text-sm"
                    >
                      <span className="font-medium text-ink">{primary}</span>
                      {secondary && (
                        <span className="text-ink-faint">{secondary}</span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        {roleChoices ? (
                          <select
                            aria-label={`Role for ${primary}`}
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void changeMemberRole(
                                member.userId,
                                event.target.value as WorkspaceRole,
                              )
                            }
                            className="rounded-md border border-line bg-panel px-2.5 py-1 font-mono text-xs text-ink"
                          >
                            {roleChoices.map((roleOption) => (
                              <option key={roleOption} value={roleOption}>
                                {roleOption}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge tone="neutral" mono>
                            {member.role}
                          </Badge>
                        )}
                        {removable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger-ghost"
                            disabled={busy}
                            onClick={() => void removeMember(member.userId, isSelf)}
                          >
                            {isSelf ? "Leave team" : "Remove"}
                          </Button>
                        )}
                      </div>
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

          {canManage && (
            <Card aria-busy={creatingInvite || busyInviteId !== null}>
              <h2 className="text-base font-semibold text-ink">
                Email invitations
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Generate a single-use invitation link for a teammate&apos;s verified
                account email. Tokens are stored hashed and expire in 7 days.
              </p>
              <form
                onSubmit={(event) => void sendInvite(event)}
                className="mt-4 flex flex-wrap gap-2"
              >
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="teammate@company.com"
                  aria-label="Invite email"
                  disabled={creatingInvite}
                  className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
                />
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as AssignableRole)
                  }
                  aria-label="Invite role"
                  disabled={creatingInvite}
                  className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <Button type="submit" disabled={creatingInvite || !inviteEmail.trim()}>
                  {creatingInvite ? "Creating…" : "Create invite link"}
                </Button>
              </form>
              {latestInvite && (
                <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <p className="text-xs font-medium text-ink">
                    Invite link for {latestInvite.email} (expires{" "}
                    {formatDate(latestInvite.expiresAt)})
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={latestInvite.url}
                      aria-label="Invitation link"
                      className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-xs text-ink"
                    />
                    <CopyButton value={latestInvite.url} label="Copy invite link" />
                  </div>
                </div>
              )}
              {invites.length > 0 ? (
                <ul className="mt-4 divide-y divide-line">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex flex-wrap items-center gap-3 py-3 text-sm"
                    >
                      <span className="font-medium text-ink">{invite.email}</span>
                      <Badge tone="neutral" mono>
                        {invite.role}
                      </Badge>
                      <span className="text-xs text-ink-faint">
                        Expires {formatDate(invite.expiresAt)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger-ghost"
                        className="ml-auto"
                        disabled={busyInviteId === invite.id}
                        onClick={() => void revokeInvite(invite.id)}
                      >
                        {busyInviteId === invite.id ? "Revoking…" : "Revoke"}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-ink-faint">
                  No pending invitations for {current.name}.
                </p>
              )}
              {inviteMessage && (
                <p role="status" className="mt-3 text-sm text-ok">
                  {inviteMessage}
                </p>
              )}
              {inviteError && (
                <p role="alert" className="mt-3 text-sm text-err">
                  {inviteError}
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {current && (
        <ConfirmDialog
          open={deleteDialogOpen}
          title={`Delete team "${current.name}"?`}
          body="Memberships and pending invites for this team will be deleted immediately. Existing analyses remain under each creator's personal job list."
          confirmLabel="Delete team"
          busy={deletingTeam}
          onConfirm={() => void confirmDeleteTeam()}
          onCancel={() => {
            if (!deletingTeam) setDeleteDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
