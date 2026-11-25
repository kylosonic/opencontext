import { withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import {
  authenticateScimToken,
  normalizeScimWorkspaceRole,
  scimErrorResponse,
  scimResponse,
  scimUserResource,
} from "@/server/workspaces";
import type { WorkspaceRole } from "@prisma/client";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function extractUpdates(body: Record<string, unknown>): {
  active?: boolean;
  displayName?: string;
  role?: WorkspaceRole;
} {
  const updates: { active?: boolean; displayName?: string; role?: WorkspaceRole } = {};
  if (typeof body.active === "boolean") updates.active = body.active;
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    updates.displayName = body.displayName.trim().slice(0, 120);
  }
  if (Array.isArray(body.roles) && body.roles[0] && typeof body.roles[0] === "object") {
    updates.role = normalizeScimWorkspaceRole(
      (body.roles[0] as { value?: unknown }).value,
    );
  }
  if (Array.isArray(body.Operations)) {
    for (const op of body.Operations) {
      if (!op || typeof op !== "object") continue;
      const entry = op as { op?: unknown; path?: unknown; value?: unknown };
      const path = typeof entry.path === "string" ? entry.path.toLowerCase() : "";
      if (path === "active" && typeof entry.value === "boolean") {
        updates.active = entry.value;
      } else if (path === "displayname" && typeof entry.value === "string" && entry.value.trim()) {
        updates.displayName = entry.value.trim().slice(0, 120);
      } else if (path === "roles" && Array.isArray(entry.value) && entry.value[0] && typeof entry.value[0] === "object") {
        updates.role = normalizeScimWorkspaceRole(
          (entry.value[0] as { value?: unknown }).value,
        );
      } else if (path === "" && entry.value && typeof entry.value === "object") {
        const val = entry.value as Record<string, unknown>;
        if (typeof val.active === "boolean") updates.active = val.active;
        if (typeof val.displayName === "string" && val.displayName.trim()) {
          updates.displayName = val.displayName.trim().slice(0, 120);
        }
      }
    }
  }
  return updates;
}

/** GET /api/scim/v2/Users/[id] — fetch one workspace member as a SCIM User. */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) return scimErrorResponse(429, "SCIM rate limit exceeded");

    const { id } = await context.params;
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
      include: { user: true, customRole: { select: { id: true, name: true } } },
    });
    if (!member) return scimErrorResponse(404, "User not found in workspace");
    return scimResponse(scimUserResource(member));
  });
}

async function handleScimUserUpdate(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) return scimErrorResponse(429, "SCIM rate limit exceeded");

    let body: Record<string, unknown>;
    try {
      const parsed = (await request.json()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return scimErrorResponse(400, "Invalid SCIM payload", "invalidSyntax");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return scimErrorResponse(400, "Request body must be valid JSON", "invalidSyntax");
    }

    const { id } = await context.params;
    const updates = extractUpdates(body);

    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
        include: { user: true, customRole: { select: { id: true, name: true } } },
      });
      if (!existing) return { kind: "NOT_FOUND" as const };

      if (updates.active === false) {
        if (existing.role === "OWNER") {
          const owners = await tx.workspaceMember.count({
            where: { workspaceId: authCtx.workspaceId, role: "OWNER" },
          });
          if (owners <= 1) return { kind: "LAST_OWNER" as const };
        }
        await tx.workspaceMember.delete({
          where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
        });
        return {
          kind: "DEACTIVATED" as const,
          resource: { ...scimUserResource(existing), active: false },
        };
      }

      if (updates.displayName) {
        await tx.user.update({
          where: { id },
          data: { name: updates.displayName },
        });
      }

      if (updates.role && existing.role !== "OWNER") {
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
          data: { role: updates.role },
        });
      }

      const refreshed = await tx.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
        include: { user: true, customRole: { select: { id: true, name: true } } },
      });
      return { kind: "OK" as const, resource: scimUserResource(refreshed) };
    });

    if (outcome.kind === "NOT_FOUND") {
      return scimErrorResponse(404, "User not found in workspace");
    }
    if (outcome.kind === "LAST_OWNER") {
      return scimErrorResponse(
        409,
        "Cannot deactivate or demote the sole workspace owner",
        "mutability",
      );
    }
    return scimResponse(outcome.resource);
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleScimUserUpdate(request, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleScimUserUpdate(request, context);
}

/** DELETE /api/scim/v2/Users/[id] — deprovision a member from the workspace. */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) return scimErrorResponse(429, "SCIM rate limit exceeded");

    const { id } = await context.params;
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
        select: { role: true },
      });
      if (!member) return "NOT_FOUND" as const;
      if (member.role === "OWNER") {
        const owners = await tx.workspaceMember.count({
          where: { workspaceId: authCtx.workspaceId, role: "OWNER" },
        });
        if (owners <= 1) return "LAST_OWNER" as const;
      }
      await tx.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: id } },
      });
      return "OK" as const;
    });

    if (result === "NOT_FOUND") {
      return scimErrorResponse(404, "User not found in workspace");
    }
    if (result === "LAST_OWNER") {
      return scimErrorResponse(
        409,
        "Cannot deprovision the sole workspace owner",
        "mutability",
      );
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
