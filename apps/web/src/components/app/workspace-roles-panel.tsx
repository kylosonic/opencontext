"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const PERMISSION_OPTIONS = [
  { id: "jobs:create", label: "Create / import jobs" },
  { id: "jobs:edit", label: "Rename / retry jobs" },
  { id: "jobs:rerun", label: "Re-run jobs" },
  { id: "jobs:delete", label: "Delete jobs" },
  { id: "jobs:share", label: "Manage public shares" },
  { id: "members:invite", label: "Invite members" },
  { id: "members:manage", label: "Manage members" },
  { id: "roles:manage", label: "Manage custom roles" },
  { id: "billing:manage", label: "Manage team billing" },
  { id: "usage:view", label: "View usage dashboard" },
] as const;

export type CustomRolePermissionId = (typeof PERMISSION_OPTIONS)[number]["id"];

export interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  memberCount: number;
}

interface WorkspaceRolesPanelProps {
  workspaceId: string;
  roles: CustomRoleRow[];
  canManage: boolean;
  onRolesChange: (nextRoles: CustomRoleRow[]) => void;
}

/** Workspace custom RBAC role builder and manager. */
export function WorkspaceRolesPanel({
  workspaceId,
  roles,
  canManage,
  onRolesChange,
}: WorkspaceRolesPanelProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([
    "jobs:create",
    "jobs:edit",
    "usage:view",
  ]);
  const [creating, setCreating] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePermission(permission: string) {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((item) => item !== permission)
        : [...prev, permission],
    );
  }

  async function handleCreateRole(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || selectedPermissions.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/roles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            permissions: selectedPermissions,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (CustomRoleRow & { error?: { message?: string } })
        | null;
      if (!response.ok || !payload?.id) {
        throw new Error(payload?.error?.message ?? "Could not create custom role.");
      }
      onRolesChange([...roles, payload]);
      setName("");
      setDescription("");
      setMessage(`Custom role "${payload.name}" created.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create custom role.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteRole(roleId: string) {
    if (busyRoleId) return;
    setBusyRoleId(roleId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? "Could not delete custom role.");
      }
      onRolesChange(roles.filter((role) => role.id !== roleId));
      setMessage("Custom role deleted.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete custom role.",
      );
    } finally {
      setBusyRoleId(null);
    }
  }

  return (
    <Card aria-busy={creating || busyRoleId !== null}>
      <h2 className="text-base font-semibold text-ink">Custom roles</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Define granular workspace permission sets and attach them to non-owner
        members or invitations.
      </p>

      {canManage && (
        <form
          onSubmit={(event) => void handleCreateRole(event)}
          className="mt-4 space-y-3 rounded-lg border border-line bg-panel-muted/40 p-4"
        >
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="Reviewer"
              aria-label="Custom role name"
              disabled={creating}
              className="min-w-44 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
              placeholder="Optional description"
              aria-label="Custom role description"
              disabled={creating}
              className="min-w-56 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
            />
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-ink-muted">
              Permissions
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PERMISSION_OPTIONS.map((perm) => {
                const checked = selectedPermissions.includes(perm.id);
                return (
                  <label
                    key={perm.id}
                    className="flex items-center gap-2 text-xs text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={creating}
                      onChange={() => togglePermission(perm.id)}
                    />
                    <span>{perm.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Button
            type="submit"
            size="sm"
            disabled={creating || !name.trim() || selectedPermissions.length === 0}
          >
            {creating ? "Creating…" : "Create custom role"}
          </Button>
        </form>
      )}

      {roles.length > 0 ? (
        <ul className="mt-4 divide-y divide-line">
          {roles.map((role) => (
            <li
              key={role.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{role.name}</span>
                  <span className="text-xs text-ink-faint">
                    {role.memberCount} {role.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                {role.description && (
                  <p className="mt-0.5 text-xs text-ink-muted">{role.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {role.permissions.map((perm) => (
                    <Badge key={perm} tone="neutral" mono>
                      {perm}
                    </Badge>
                  ))}
                </div>
              </div>
              {canManage && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger-ghost"
                  disabled={busyRoleId === role.id}
                  onClick={() => void handleDeleteRole(role.id)}
                >
                  {busyRoleId === role.id ? "Deleting…" : "Delete role"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">
          No custom roles created for this team yet.
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
