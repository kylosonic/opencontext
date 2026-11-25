import { withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import {
  authenticateScimToken,
  scimErrorResponse,
  scimGroupResource,
  scimResponse,
} from "@/server/workspaces";

export const runtime = "nodejs";

/** GET /api/scim/v2/Groups — expose the token-scoped workspace as a SCIM Group. */
export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const authCtx = await authenticateScimToken(request);
    if (!authCtx) return scimErrorResponse(401, "Invalid or missing SCIM bearer token");
    const limit = await consumeRateLimit(
      `scim:${authCtx.workspaceId}`,
      RATE_LIMITS.scim.limit,
      RATE_LIMITS.scim.windowMs,
    );
    if (!limit.allowed) return scimErrorResponse(429, "SCIM rate limit exceeded");

    const workspace = await prisma.workspace.findUnique({
      where: { id: authCtx.workspaceId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!workspace) {
      return scimErrorResponse(404, "Workspace not found");
    }

    const resources = [scimGroupResource(workspace, workspace.members)];
    return scimResponse({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    });
  });
}
