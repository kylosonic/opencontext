import { scimResponse } from "@/server/workspaces";

export const runtime = "nodejs";

/** GET /api/scim/v2/ServiceProviderConfig — SCIM 2.0 capability descriptor. */
export async function GET(): Promise<Response> {
  return scimResponse({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer Token",
        description: "Workspace-scoped SCIM 2.0 provisioning token",
        primary: true,
      },
    ],
  });
}
