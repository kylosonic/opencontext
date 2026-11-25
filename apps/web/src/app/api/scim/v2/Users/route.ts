import { withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import {
  authenticateScimToken,
  normalizeScimWorkspaceRole,
  parseScimUserNameFilter,
  scimErrorResponse,
  scimResponse,
  scimUserResource,
} from "@/server/workspaces";

export const runtime = "nodejs";

function extractEmail(body: Record<string, unknown>): string | null {
  const userName = typeof body.userName === "string" ? body.userName.trim().toLowerCase() : "";
  if (userName.includes("@")) return userName;
  if (Array.isArray(body.emails)) {
    for (const item of body.emails) {
      if (item && typeof item === "object" && typeof (item as { value?: unknown }).value === "string") {
        const candidate = ((item as { value: string }).value).trim().toLowerCase();
        if (candidate.includes("@")) return candidate;
      }
    }
  }
  return null;
}

function extractDisplayName(body: Record<string, unknown>): string | null {
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    return body.displayName.trim().slice(0, 120);
  }
  if (body.name && typeof body.name === "object") {
    const formatted = (body.name as { formatted?: unknown }).formatted;
    if (typeof formatted === "string" && formatted.trim()) {
      return formatted.trim().slice(0, 120);
    }
  }
  return null;
}

/** GET /api/scim/v2/Users — list SCIM-visible members of the token's workspace. */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) {
      return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    }
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) {
      return scimErrorResponse(429, "SCIM rate limit exceeded");
    }

    const filterEmail = parseScimUserNameFilter(
      new URL(request.url).searchParams.get("filter"),
    );
    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: authCtx.workspaceId,
        ...(filterEmail ? { user: { email: filterEmail } } : {}),
      },
      include: {
        user: true,
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const resources = members.map((member) => scimUserResource(member));
    return scimResponse({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  });
}

/** POST /api/scim/v2/Users — provision a user and add them to the token's workspace. */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) {
      return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    }
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) {
      return scimErrorResponse(429, "SCIM rate limit exceeded");
    }

    let body: Record<string, unknown>;
    try {
      const parsed = (await request.json()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return scimErrorResponse(400, "Invalid SCIM user payload", "invalidSyntax");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return scimErrorResponse(400, "Request body must be valid JSON", "invalidSyntax");
    }

    const email = extractEmail(body);
    if (!email) {
      return scimErrorResponse(400, "SCIM user requires a valid email userName", "invalidValue");
    }
    const displayName = extractDisplayName(body);
    const roles = Array.isArray(body.roles) ? body.roles : [];
    const firstRole =
      roles[0] && typeof roles[0] === "object"
        ? (roles[0] as { value?: unknown }).value
        : undefined;
    const role = normalizeScimWorkspaceRole(firstRole);

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            email,
            name: displayName ?? email.split("@")[0],
          },
        });
      } else if (displayName && !user.name) {
        user = await tx.user.update({
          where: { id: user.id },
          data: { name: displayName },
        });
      }

      const existingMembership = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: authCtx.workspaceId, userId: user.id },
        },
      });
      if (existingMembership) {
        return { kind: "CONFLICT" as const };
      }

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: authCtx.workspaceId,
          userId: user.id,
          role,
        },
        include: {
          user: true,
          customRole: { select: { id: true, name: true } },
        },
      });
      return { kind: "OK" as const, member };
    });

    if (result.kind === "CONFLICT") {
      return scimErrorResponse(
        409,
        "User is already provisioned in this workspace",
        "uniqueness",
      );
    }

    return scimResponse(scimUserResource(result.member), 201);
  });
}
