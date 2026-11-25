import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { hasWorkspacePermission, validateWorkspaceCustomRoleId } from "./roles";

const INVITE_EMAIL_MAX = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 720;
const DEFAULT_TTL_HOURS = 24 * 7;

export const INVITABLE_WORKSPACE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type InvitableWorkspaceRole = (typeof INVITABLE_WORKSPACE_ROLES)[number];

function inviteTtlHours(): number {
  const parsed = Number.parseInt(
    process.env.WORKSPACE_INVITE_TTL_HOURS ?? String(DEFAULT_TTL_HOURS),
    10,
  );
  if (!Number.isSafeInteger(parsed)) return DEFAULT_TTL_HOURS;
  return Math.min(Math.max(parsed, MIN_TTL_HOURS), MAX_TTL_HOURS);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeInviteEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > INVITE_EMAIL_MAX ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export interface WorkspaceInviteView {
  id: string;
  email: string;
  role: InvitableWorkspaceRole;
  customRoleId: string | null;
  customRoleName: string | null;
  expiresAt: string;
  createdAt: string;
}

export type CreateInviteResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID_EMAIL" }
  | { kind: "INVALID_CUSTOM_ROLE" }
  | { kind: "ALREADY_MEMBER" }
  | { kind: "OK"; invite: WorkspaceInviteView; token: string; url: string };

/** Create an expiring single-use email invitation for a workspace (members:invite). */
export async function createWorkspaceInvite(
  workspaceId: string,
  actorId: string,
  rawEmail: string,
  role: InvitableWorkspaceRole,
  customRoleId?: string | null,
): Promise<CreateInviteResult> {
  const actor = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorId } },
    select: { role: true },
  });
  if (!actor) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "members:invite"))) {
    return { kind: "FORBIDDEN" };
  }
  if (
    customRoleId &&
    (await validateWorkspaceCustomRoleId(workspaceId, customRoleId)) === "INVALID"
  ) {
    return { kind: "INVALID_CUSTOM_ROLE" };
  }

  const email = normalizeInviteEmail(rawEmail);
  if (!email) return { kind: "INVALID_EMAIL" };

  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId, user: { email } },
    select: { userId: true },
  });
  if (existingMember) return { kind: "ALREADY_MEMBER" };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + inviteTtlHours() * 3_600_000);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);

  const created = await prisma.$transaction(async (tx) => {
    await tx.workspaceInvite.updateMany({
      where: { workspaceId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.workspaceInvite.create({
      data: {
        workspaceId,
        email,
        role,
        customRoleId: customRoleId || null,
        tokenHash,
        invitedById: actorId,
        expiresAt,
      },
      include: { customRole: { select: { id: true, name: true } } },
    });
  });

  return {
    kind: "OK",
    invite: {
      id: created.id,
      email: created.email,
      role: created.role as InvitableWorkspaceRole,
      customRoleId: created.customRoleId ?? null,
      customRoleName: created.customRole?.name ?? null,
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
    },
    token,
    url: `/app/teams/invite/${token}`,
  };
}

export type ListInvitesResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK"; invites: WorkspaceInviteView[] };

/** List active pending invitations for a workspace (members:invite). */
export async function listWorkspaceInvites(
  workspaceId: string,
  actorId: string,
): Promise<ListInvitesResult> {
  const actor = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorId } },
    select: { role: true },
  });
  if (!actor) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "members:invite"))) {
    return { kind: "FORBIDDEN" };
  }
  const now = new Date();
  const rows = await prisma.workspaceInvite.findMany({
    where: {
      workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: { customRole: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    kind: "OK",
    invites: rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as InvitableWorkspaceRole,
      customRoleId: row.customRoleId ?? null,
      customRoleName: row.customRole?.name ?? null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export type RevokeInviteResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

export async function revokeWorkspaceInvite(
  workspaceId: string,
  actorId: string,
  inviteId: string,
): Promise<RevokeInviteResult> {
  const actor = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorId } },
    select: { role: true },
  });
  if (!actor) return { kind: "NOT_FOUND" };
  if (!(await hasWorkspacePermission(workspaceId, actorId, "members:invite"))) {
    return { kind: "FORBIDDEN" };
  }
  const invite = await prisma.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId },
    select: { id: true, revokedAt: true },
  });
  if (!invite) return { kind: "NOT_FOUND" };
  if (!invite.revokedAt) {
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
  }
  return { kind: "OK" };
}

export type InviteInspection =
  | { status: "NOT_FOUND" }
  | { status: "REVOKED"; workspaceName: string }
  | { status: "ACCEPTED"; workspaceName: string }
  | { status: "EXPIRED"; workspaceName: string }
  | {
      status: "VALID";
      workspaceId: string;
      workspaceName: string;
      email: string;
      role: InvitableWorkspaceRole;
      expiresAt: string;
    };

export async function inspectWorkspaceInvite(
  token: string,
): Promise<InviteInspection> {
  const normalized = token.trim();
  if (!normalized) return { status: "NOT_FOUND" };
  const row = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(normalized) },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!row) return { status: "NOT_FOUND" };
  if (row.revokedAt) {
    return { status: "REVOKED", workspaceName: row.workspace.name };
  }
  if (row.acceptedAt) {
    return { status: "ACCEPTED", workspaceName: row.workspace.name };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { status: "EXPIRED", workspaceName: row.workspace.name };
  }
  return {
    status: "VALID",
    workspaceId: row.workspaceId,
    workspaceName: row.workspace.name,
    email: row.email,
    role: row.role as InvitableWorkspaceRole,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export type AcceptInviteResult =
  | { kind: "NOT_FOUND" }
  | { kind: "REVOKED" }
  | { kind: "ACCEPTED" }
  | { kind: "EXPIRED" }
  | { kind: "EMAIL_REQUIRED" }
  | { kind: "EMAIL_MISMATCH"; expectedEmail: string }
  | {
      kind: "OK";
      workspaceId: string;
      workspaceName: string;
      role: InvitableWorkspaceRole;
    };

/** Atomically accept a workspace invitation matching the caller's verified email. */
export async function acceptWorkspaceInvite(
  token: string,
  userId: string,
): Promise<AcceptInviteResult> {
  const normalized = token.trim();
  if (!normalized) return { kind: "NOT_FOUND" };
  const [invite, user] = await Promise.all([
    prisma.workspaceInvite.findUnique({
      where: { tokenHash: hashInviteToken(normalized) },
      include: { workspace: { select: { id: true, name: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    }),
  ]);
  if (!invite) return { kind: "NOT_FOUND" };
  if (invite.revokedAt) return { kind: "REVOKED" };
  if (invite.acceptedAt) return { kind: "ACCEPTED" };
  if (invite.expiresAt.getTime() <= Date.now()) return { kind: "EXPIRED" };
  const userEmail = user?.email?.trim().toLowerCase();
  if (!userEmail) return { kind: "EMAIL_REQUIRED" };
  if (userEmail !== invite.email.trim().toLowerCase()) {
    return { kind: "EMAIL_MISMATCH", expectedEmail: invite.email };
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.workspaceInvite.updateMany({
      where: {
        id: invite.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) return { kind: "ACCEPTED" as const };
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
      create: {
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
        customRoleId: invite.customRoleId ?? null,
      },
      update: {},
    });
    return {
      kind: "OK" as const,
      workspaceId: invite.workspaceId,
      workspaceName: invite.workspace.name,
      role: invite.role as InvitableWorkspaceRole,
    };
  });
}
