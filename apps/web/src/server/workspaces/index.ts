import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

const WORKSPACE_NAME_MAX = 80;
const MEMBER_IDENTIFIER_MAX = 255;

export const WORKSPACE_ROLES = ["ADMIN", "MEMBER"] as const;

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  jobCount: number;
};

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

export async function createWorkspace(userId: string, name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > WORKSPACE_NAME_MAX) {
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
  if (actorRole === "MEMBER") return { kind: "FORBIDDEN" as const };
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
