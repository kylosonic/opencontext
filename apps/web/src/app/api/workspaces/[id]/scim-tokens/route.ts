import { z } from "zod";
import { withErrorHandling } from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";
import {
  errorWithLimit,
  jsonWithLimit,
  parseValidatedJson,
  requireSessionWithLimit,
} from "@/server/session-guard";
import {
  createWorkspaceScimToken,
  listWorkspaceScimTokens,
} from "@/server/workspaces";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const CreateScimTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

/** GET /api/workspaces/[id]/scim-tokens — list active SCIM tokens (OWNER only). */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-scim-tokens-read",
      RATE_LIMITS.jobsRead,
      "SCIM tokens",
    );
    if (authState.kind !== "OK") return authState.response;

    const { id } = await context.params;
    const result = await listWorkspaceScimTokens(id, authState.userId);
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners can manage SCIM tokens",
        authState.limit,
      );
    }
    return jsonWithLimit(result.tokens, authState.limit);
  });
}

/** POST /api/workspaces/[id]/scim-tokens — issue an OWNER-scoped SCIM bearer token. */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const authState = await requireSessionWithLimit(
      "workspace-scim-token-create",
      RATE_LIMITS.workspaceMutation,
      "SCIM tokens",
    );
    if (authState.kind !== "OK") return authState.response;
    const parsed = await parseValidatedJson(
      request,
      CreateScimTokenSchema,
      authState.limit,
      "Provide a descriptive token name",
    );
    if (!parsed.ok) return parsed.response;

    const { id } = await context.params;
    const result = await createWorkspaceScimToken(
      id,
      authState.userId,
      parsed.data.name,
    );
    if (result.kind === "NOT_FOUND") {
      return errorWithLimit("NOT_FOUND", "Team not found", authState.limit);
    }
    if (result.kind === "FORBIDDEN") {
      return errorWithLimit(
        "FORBIDDEN",
        "Only team owners can manage SCIM tokens",
        authState.limit,
      );
    }
    if (result.kind === "LIMIT_REACHED") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Maximum number of active SCIM tokens reached",
        authState.limit,
      );
    }
    if (result.kind === "INVALID") {
      return errorWithLimit(
        "VALIDATION_ERROR",
        "Provide a valid token name",
        authState.limit,
      );
    }
    return jsonWithLimit(
      { tokenRecord: result.tokenRecord, token: result.token },
      authState.limit,
      201,
    );
  });
}
