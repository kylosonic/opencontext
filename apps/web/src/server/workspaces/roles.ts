import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { workspaceRole } from "./index";

export const WORKSPACE_PERMISSIONS = [
  "jobs:create",
  "jobs:edit",
  "jobs:delete",
  "jobs:rerun",
  "jobs:share",
  "members:invite",
  "members:manage",
  "roles:manage",
  "billing:manage",
  "usage:view",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(WORKSPACE_PERMISSIONS);
const MAX_CUSTOM_ROLES_PER_WORKSPACE = 25;
const ROLE_NAME_MAX = 60;
const ROLE_DESCRIPTION_MAX = 200;

export const DEFAULT_ROLE_PERMISSIONS: Record<
  WorkspaceRole,
  readonly WorkspacePermission[]
> = {
  OWNER: [...WORKSPACE_PERMISSIONS],
  ADMIN: [...WORKSPACE_PERMISSIONS],
  MEMBER: ["jobs:create", "jobs:rerun", "usage:view"],
  VIEWER: ["usage:view"],
};

export interface WorkspaceCustomRoleSummary {
  id: string;
  name: string;
  description: string | null;
  permissions: WorkspacePermission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export function normalizeRoleName(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > ROLE_NAME_MAX) return null;
  return cleaned;
}

export function normalizeRoleDescription(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.slice(0, ROLE_DESCRIPTION_MAX);
}

/** Validate and deduplicate a non-empty permission list against WORKSPACE_PERMISSIONS. */
export function normalizeCustomPermissions(
  input: unknown,
): WorkspacePermission[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const deduped: WorkspacePermission[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string" || !PERMISSION_SET.has(item)) {
      return null;
    }
    if (!seen.has(item)) {
      seen.add(item);
      deduped.push(item as WorkspacePermission);
    }
  }
  return deduped.length > 0 ? deduped : null;
}

function coerceStoredPermissions(raw: unknown): WorkspacePermission[] {
  if (!Array.isArray(raw)) return [];
  const valid: WorkspacePermission[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && PERMISSION_SET.has(entry)) {
      valid.push(entry as WorkspacePermission);
    }
  }
  return valid;
}

/**
 * Resolve effective permissions for `userId` in `workspaceId`.
 * `OWNER` always retains full permissions; otherwise an assigned custom role
 * overrides default role permissions.
 */
export async function workspacePermissions(
  workspaceId: string,
  userId: string,
): Promise<Set<WorkspacePermission>> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      role: true,
      customRole: { select: { permissions: true } },
    },
  });
  if (!membership) return new Set();
  if (membership.role === "OWNER") {
    return new Set(WORKSPACE_PERMISSIONS);
  }
  if (membership.customRole) {
    return new Set(coerceStoredPermissions(membership.customRole.permissions));
  }
  return new Set(DEFAULT_ROLE_PERMISSIONS[membership.role] ?? []);
}

export async function hasWorkspacePermission(
  workspaceId: string,
  userId: string,
  permission: WorkspacePermission,
): Promise<boolean> {
  const perms = await workspacePermissions(workspaceId, userId);
  return perms.has(permission);
}

export async function validateWorkspaceCustomRoleId(
  workspaceId: string,
  customRoleId?: string | null,
): Promise<"OK" | "INVALID"> {
  if (!customRoleId) return "OK";
  const found = await prisma.workspaceCustomRole.findFirst({
    where: { id: customRoleId, workspaceId },
    select: { id: true },
  });
  return found ? "OK" : "INVALID";
}

function serializeCustomRole(row: {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
  createdAt: Date;
  updatedAt: Date;
  _count?: { members: number };
}): WorkspaceCustomRoleSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: coerceStoredPermissions(row.permissions),
    memberCount: row._count?.members ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ListCustomRolesResult =
  | { kind: "NOT_FOUND" }
  | { kind: "OK"; roles: WorkspaceCustomRoleSummary[] };

export async function listWorkspaceCustomRoles(
  workspaceId: string,
  userId: string,
): Promise<ListCustomRolesResult> {
  const role = await workspaceRole(workspaceId, userId);
  if (!role) return { kind: "NOT_FOUND" };

  const rows = await prisma.workspaceCustomRole.findMany({
    where: { workspaceId },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { kind: "OK", roles: rows.map(serializeCustomRole) };
}

export type CreateCustomRoleResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID" }
  | { kind: "LIMIT_REACHED" }
  | { kind: "DUPLICATE_NAME" }
  | { kind: "OK"; role: WorkspaceCustomRoleSummary };

export async function createWorkspaceCustomRole(
  workspaceId: string,
  actorId: string,
  input: { name: string; description?: string | null; permissions: unknown },
): Promise<CreateCustomRoleResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "roles:manage"))) {
    return { kind: "FORBIDDEN" };
  }
  const name = normalizeRoleName(input.name);
  const permissions = normalizeCustomPermissions(input.permissions);
  if (!name || !permissions) return { kind: "INVALID" };

  const count = await prisma.workspaceCustomRole.count({ where: { workspaceId } });
  if (count >= MAX_CUSTOM_ROLES_PER_WORKSPACE) {
    return { kind: "LIMIT_REACHED" };
  }

  const existing = await prisma.workspaceCustomRole.findUnique({
    where: { workspaceId_name: { workspaceId, name } },
    select: { id: true },
  });
  if (existing) return { kind: "DUPLICATE_NAME" };

  const created = await prisma.workspaceCustomRole.create({
    data: {
      workspaceId,
      name,
      description: normalizeRoleDescription(input.description),
      permissions,
    },
    include: { _count: { select: { members: true } } },
  });
  return { kind: "OK", role: serializeCustomRole(created) };
}

export type UpdateCustomRoleResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID" }
  | { kind: "DUPLICATE_NAME" }
  | { kind: "OK"; role: WorkspaceCustomRoleSummary };

export async function updateWorkspaceCustomRole(
  workspaceId: string,
  actorId: string,
  roleId: string,
  input: { name?: string; description?: string | null; permissions?: unknown },
): Promise<UpdateCustomRoleResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "roles:manage"))) {
    return { kind: "FORBIDDEN" };
  }
  const existing = await prisma.workspaceCustomRole.findFirst({
    where: { id: roleId, workspaceId },
  });
  if (!existing) return { kind: "NOT_FOUND" };

  const nextName =
    input.name !== undefined ? normalizeRoleName(input.name) : existing.name;
  const nextPermissions =
    input.permissions !== undefined
      ? normalizeCustomPermissions(input.permissions)
      : coerceStoredPermissions(existing.permissions);
  if (!nextName || !nextPermissions || nextPermissions.length === 0) {
    return { kind: "INVALID" };
  }
  if (nextName !== existing.name) {
    const duplicate = await prisma.workspaceCustomRole.findUnique({
      where: { workspaceId_name: { workspaceId, name: nextName } },
      select: { id: true },
    });
    if (duplicate) return { kind: "DUPLICATE_NAME" };
  }

  const nextDescription =
    input.description !== undefined
      ? normalizeRoleDescription(input.description)
      : existing.description;

  const updated = await prisma.workspaceCustomRole.update({
    where: { id: roleId },
    data: {
      name: nextName,
      description: nextDescription,
      permissions: nextPermissions,
    },
    include: { _count: { select: { members: true } } },
  });
  return { kind: "OK", role: serializeCustomRole(updated) };
}

export type DeleteCustomRoleResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

export async function deleteWorkspaceCustomRole(
  workspaceId: string,
  actorId: string,
  roleId: string,
): Promise<DeleteCustomRoleResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "roles:manage"))) {
    return { kind: "FORBIDDEN" };
  }
  const deleted = await prisma.workspaceCustomRole.deleteMany({
    where: { id: roleId, workspaceId },
  });
  if (deleted.count === 0) return { kind: "NOT_FOUND" };
  return { kind: "OK" };
}
