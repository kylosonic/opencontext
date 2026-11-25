import { createHash, randomBytes } from "node:crypto";
import type { WorkspaceRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { workspaceRole } from "./index";

export const SCIM_CONTENT_TYPE = "application/scim+json";

const TOKEN_NAME_MAX = 80;
const MAX_TOKENS_PER_WORKSPACE = 10;

export interface WorkspaceScimTokenSummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function hashScimToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function normalizeTokenName(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > TOKEN_NAME_MAX) return null;
  return cleaned;
}

export function scimResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export function scimErrorResponse(
  status: number,
  detail: string,
  scimType?: string,
): NextResponse {
  return scimResponse(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    status,
  );
}

export type CreateScimTokenResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "INVALID" }
  | { kind: "LIMIT_REACHED" }
  | { kind: "OK"; tokenRecord: WorkspaceScimTokenSummary; token: string };

/** Create an OWNER-scoped workspace SCIM 2.0 bearer token (plaintext returned once). */
export async function createWorkspaceScimToken(
  workspaceId: string,
  actorId: string,
  rawName: string,
): Promise<CreateScimTokenResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER") return { kind: "FORBIDDEN" };

  const name = normalizeTokenName(rawName);
  if (!name) return { kind: "INVALID" };

  const activeCount = await prisma.workspaceScimToken.count({
    where: { workspaceId, revokedAt: null },
  });
  if (activeCount >= MAX_TOKENS_PER_WORKSPACE) {
    return { kind: "LIMIT_REACHED" };
  }

  const rawToken = `oc_scim_${randomBytes(32).toString("base64url")}`;
  const prefix = rawToken.slice(0, 12);
  const created = await prisma.workspaceScimToken.create({
    data: {
      workspaceId,
      name,
      prefix,
      tokenHash: hashScimToken(rawToken),
      createdById: actorId,
    },
  });

  return {
    kind: "OK",
    token: rawToken,
    tokenRecord: {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      lastUsedAt: null,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export type ListScimTokensResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK"; tokens: WorkspaceScimTokenSummary[] };

export async function listWorkspaceScimTokens(
  workspaceId: string,
  actorId: string,
): Promise<ListScimTokensResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER") return { kind: "FORBIDDEN" };

  const rows = await prisma.workspaceScimToken.findMany({
    where: { workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return {
    kind: "OK",
    tokens: rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export type RevokeScimTokenResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK" };

export async function revokeWorkspaceScimToken(
  workspaceId: string,
  actorId: string,
  tokenId: string,
): Promise<RevokeScimTokenResult> {
  const actorRole = await workspaceRole(workspaceId, actorId);
  if (!actorRole) return { kind: "NOT_FOUND" };
  if (actorRole !== "OWNER") return { kind: "FORBIDDEN" };

  const existing = await prisma.workspaceScimToken.findFirst({
    where: { id: tokenId, workspaceId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return { kind: "NOT_FOUND" };
  if (!existing.revokedAt) {
    await prisma.workspaceScimToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }
  return { kind: "OK" };
}

/** Validate a SCIM 2.0 Bearer token and stamp `lastUsedAt` best-effort. */
export async function authenticateScimToken(
  request: Request,
): Promise<{ workspaceId: string; tokenId: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const rawToken = match?.[1];
  if (!rawToken || !rawToken.startsWith("oc_scim_")) return null;

  const row = await prisma.workspaceScimToken.findFirst({
    where: {
      tokenHash: hashScimToken(rawToken),
      revokedAt: null,
    },
    select: { id: true, workspaceId: true },
  });
  if (!row) return null;

  await prisma.workspaceScimToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { workspaceId: row.workspaceId, tokenId: row.id };
}

export function parseScimUserNameFilter(filterParam: string | null): string | null {
  if (!filterParam) return null;
  const match = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filterParam);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

export function normalizeScimWorkspaceRole(raw: unknown): WorkspaceRole {
  if (typeof raw !== "string") return "MEMBER";
  const upper = raw.trim().toUpperCase();
  if (upper === "ADMIN" || upper === "MEMBER" || upper === "VIEWER") {
    return upper;
  }
  return "MEMBER";
}

export function scimUserResource(member: {
  role: WorkspaceRole;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    githubLogin: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  customRole?: { id: string; name: string } | null;
}) {
  const userName =
    member.user.email ?? member.user.githubLogin ?? member.user.id;
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: member.user.id,
    userName,
    displayName: member.user.name ?? userName,
    active: true,
    emails: member.user.email
      ? [{ value: member.user.email, primary: true, type: "work" }]
      : [],
    roles: [
      {
        value: member.role,
        display: member.customRole?.name ?? member.role,
        primary: true,
      },
    ],
    meta: {
      resourceType: "User",
      created: member.user.createdAt.toISOString(),
      lastModified: member.user.updatedAt.toISOString(),
    },
  };
}

export function scimGroupResource(
  workspace: { id: string; name: string; createdAt: Date; updatedAt: Date },
  members: Array<{
    user: { id: string; email: string | null; name: string | null };
  }>,
) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: workspace.id,
    displayName: workspace.name,
    members: members.map((member) => ({
      value: member.user.id,
      display: member.user.name ?? member.user.email ?? member.user.id,
    })),
    meta: {
      resourceType: "Group",
      created: workspace.createdAt.toISOString(),
      lastModified: workspace.updatedAt.toISOString(),
    },
  };
}
