import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

const WORKSPACE_NAME_MAX = 80;
const MEMBER_IDENTIFIER_MAX = 255;

export const WORKSPACE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
export const WORKSPACE_ALL_ROLES = [
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
] as const;

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  jobCount: number;
};

function normalizeWorkspaceName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > WORKSPACE_NAME_MAX) return null;
  return normalized;
}

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: {
        include: {
          _count: { select: { members: true, jobs: true } },
        },
      },
    },
    orderBy: { workspace: { createdAt: "asc" } },
  });
  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
    memberCount: membership.workspace._count.members,
    jobCount: membership.workspace._count.jobs,
  }));
}

export async function workspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

export async function canAccessWorkspace(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  return (await workspaceRole(workspaceId, userId)) !== null;
}

/** Whether a user may upload, import, or re-run jobs inside a workspace. */
export async function canContributeToWorkspace(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const role = await workspaceRole(workspaceId, userId);
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

export async function createWorkspace(userId: string, name: string) {
  const normalized = normalizeWorkspaceName(name);
  if (!normalized) {
    return { kind: "INVALID" as const };
  }
  return {
    kind: "OK" as const,
    workspace: await prisma.workspace.create({
      data: {
        name: normalized,
        members: { create: { userId, role: "OWNER" } },
      },
      include: { _count: { select: { members: true, jobs: true } } },
    }),
  };
}

export type RenameWorkspaceResult =
  | { kind: "INVALID" }
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK"; workspace: WorkspaceSummary };

export async function renameWorkspace(
  workspaceId: string,
  actorId: string,
  name: string,
): Promise<RenameWorkspaceResult> {
  const normalized = normalizeWorkspaceName(name);
  if (!normalized) return { kind: "INVALID" };
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    return { kind: "FORBIDDEN" };
  }
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: normalized },
    include: { _count: { select: { members: true, jobs: true } } },
  });
  return {
    kind: "OK",
    workspace: {
      id: updated.id,
      name: updated.name,
      role: actorRole,
      memberCount: updated._count.members,
      jobCount: updated._count.jobs,
    },
  };
}

export type DeleteWorkspaceResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

export async function deleteWorkspace(
  workspaceId: string,
  actorId: string,
): Promise<DeleteWorkspaceResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER") return { kind: "FORBIDDEN" };
  await prisma.workspace.delete({ where: { id: workspaceId } });
  return { kind: "OK" };
}

export type AddMemberResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "USER_NOT_FOUND" }
  | { kind: "ALREADY_MEMBER" }
  | { kind: "OK"; user: { id: string; name: string | null; email: string | null } };

/** Add an existing OpenContext user by email or GitHub login. */
export async function addWorkspaceMember(
  workspaceId: string,
  actorId: string,
  identifier: string,
  role: (typeof WORKSPACE_ROLES)[number],
): Promise<AddMemberResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" as const };
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    return { kind: "FORBIDDEN" as const };
  }
  const normalized = identifier.trim();
  if (!normalized || normalized.length > MEMBER_IDENTIFIER_MAX) {
    return { kind: "USER_NOT_FOUND" };
  }
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalized.toLowerCase() }, { githubLogin: normalized }],
    },
    select: { id: true, name: true, email: true },
  });
  if (!user) return { kind: "USER_NOT_FOUND" as const };
  if (await workspaceRole(workspaceId, user.id))
    return { kind: "ALREADY_MEMBER" as const };
  await prisma.workspaceMember.create({
    data: { workspaceId, userId: user.id, role },
  });
  return { kind: "OK", user };
}

export type UpdateMemberRoleResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "LAST_OWNER" }
  | { kind: "OK"; userId: string; role: WorkspaceRole };

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  nextRole: WorkspaceRole,
): Promise<UpdateMemberRoleResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    return { kind: "FORBIDDEN" };
  }
  const targetRole = await workspaceRole(workspaceId, targetUserId);
  if (!targetRole) return { kind: "NOT_FOUND" };
  if (
    actorRole === "ADMIN" &&
    (targetRole === "OWNER" || targetRole === "ADMIN" || nextRole === "OWNER")
  ) {
    return { kind: "FORBIDDEN" };
  }

  return prisma.$transaction(async (tx) => {
    if (targetRole === "OWNER" && nextRole !== "OWNER") {
      const owners = await tx.workspaceMember.count({
        where: { workspaceId, role: "OWNER" },
      });
      if (owners <= 1) return { kind: "LAST_OWNER" as const };
    }
    const updated = await tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: nextRole },
    });
    return {
      kind: "OK" as const,
      userId: updated.userId,
      role: updated.role,
    };
  });
}

export type RemoveMemberResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "LAST_OWNER" }
  | { kind: "OK" };

export async function removeWorkspaceMember(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  const targetRole = await workspaceRole(workspaceId, targetUserId);
  if (!targetRole) return { kind: "NOT_FOUND" };

  if (actorId !== targetUserId) {
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      return { kind: "FORBIDDEN" };
    }
    if (
      actorRole === "ADMIN" &&
      (targetRole === "OWNER" || targetRole === "ADMIN")
    ) {
      return { kind: "FORBIDDEN" };
    }
  }

  return prisma.$transaction(async (tx) => {
    if (targetRole === "OWNER") {
      const owners = await tx.workspaceMember.count({
        where: { workspaceId, role: "OWNER" },
      });
      if (owners <= 1) return { kind: "LAST_OWNER" as const };
    }
    await tx.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    return { kind: "OK" as const };
  });
}

export async function listWorkspaceMembers(workspaceId: string, userId: string) {
  if (!(await canAccessWorkspace(workspaceId, userId))) return null;
  return prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, githubLogin: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** A job owner or a team administrator may delete/retry a team job. */
export async function canManageJob(
  job: { userId: string; workspaceId: string | null },
  userId: string,
): Promise<boolean> {
  if (job.userId === userId) return true;
  if (!job.workspaceId) return false;
  const role = await workspaceRole(job.workspaceId, userId);
  return role === "OWNER" || role === "ADMIN";
}

export * from "./invites";
