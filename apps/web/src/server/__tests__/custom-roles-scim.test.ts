import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { GET as rolesGet, POST as rolesPost } from "@/app/api/workspaces/[id]/roles/route";
import {
  PATCH as rolePatch,
  DELETE as roleDelete,
} from "@/app/api/workspaces/[id]/roles/[roleId]/route";
import {
  GET as scimTokensGet,
  POST as scimTokensPost,
} from "@/app/api/workspaces/[id]/scim-tokens/route";
import { DELETE as scimTokenDelete } from "@/app/api/workspaces/[id]/scim-tokens/[tokenId]/route";
import { GET as scimServiceConfigGet } from "@/app/api/scim/v2/ServiceProviderConfig/route";
import {
  GET as scimUsersGet,
  POST as scimUsersPost,
} from "@/app/api/scim/v2/Users/route";
import {
  GET as scimUserGet,
  PATCH as scimUserPatch,
  DELETE as scimUserDelete,
} from "@/app/api/scim/v2/Users/[id]/route";
import { GET as scimGroupsGet } from "@/app/api/scim/v2/Groups/route";
import { prisma } from "@/server/db/prisma";
import { usageSummaryForUser } from "@/server/billing/usage";
import { deleteJob, initialStageStates, renameJob, rerunJob } from "@/server/jobs";
import { createJobShare } from "@/server/jobs/shares";
import { resetRateLimits } from "@/server/security/rate-limit";
import { storage } from "@/server/storage";
import { createUploadIntent } from "@/server/uploads";
import {
  addWorkspaceMember,
  createWorkspace,
  updateWorkspaceMemberRole,
} from "@/server/workspaces";
import { createUser, resetDatabase, resetStorage, TEST_BYTES, testStream } from "./helpers";

function asUser(userId: string): void {
  authMock.auth.mockResolvedValue({ user: { id: userId, name: "User" } });
}

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
  resetRateLimits();
  authMock.auth.mockReset();
});

describe("custom workspace roles", () => {
  it("supports custom role CRUD, fine-grained permission enforcement, and delete fallback", async () => {
    const owner = await createUser();
    const reviewer = await createUser();
    const created = await createWorkspace(owner.id, "Enterprise Team");
    if (created.kind !== "OK") throw new Error("expected workspace");
    const wsId = created.workspace.id;

    expect(
      (await addWorkspaceMember(wsId, owner.id, reviewer.email, "VIEWER")).kind,
    ).toBe("OK");

    asUser(owner.id);
    const createRes = await rolesPost(
      new Request(`http://localhost/api/workspaces/${wsId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Job Editor",
          description: "Can rename, share, and rerun jobs but cannot delete",
          permissions: ["jobs:create", "jobs:edit", "jobs:rerun", "jobs:share"],
        }),
      }),
      { params: Promise.resolve({ id: wsId }) },
    );
    expect(createRes.status).toBe(201);
    const roleBody = (await createRes.json()) as { id: string; permissions: string[] };
    expect(roleBody.permissions).toEqual([
      "jobs:create",
      "jobs:edit",
      "jobs:rerun",
      "jobs:share",
    ]);

    const updateRes = await rolePatch(
      new Request(`http://localhost/api/workspaces/${wsId}/roles/${roleBody.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lead Reviewer" }),
      }),
      { params: Promise.resolve({ id: wsId, roleId: roleBody.id }) },
    );
    expect(updateRes.status).toBe(200);

    // Assign custom role to the reviewer (even while base enum stays VIEWER)
    const assigned = await updateWorkspaceMemberRole(
      wsId,
      owner.id,
      reviewer.id,
      "VIEWER",
      roleBody.id,
    );
    expect(assigned.kind).toBe("OK");

    const job = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: wsId,
        displayName: "sso-walkthrough.mp4",
        status: "COMPLETED",
        sourceExt: "mp4",
        sourceSize: TEST_BYTES.length,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    const sourceKey = `jobs/${job.id}/source.mp4`;
    await storage.put(sourceKey, testStream(), { sizeBytes: TEST_BYTES.length });
    await prisma.job.update({ where: { id: job.id }, data: { sourceKey } });

    // Custom role grants jobs:edit, jobs:share, jobs:rerun, jobs:create...
    expect((await renameJob(job.id, reviewer.id, "Renamed by Lead")).kind).toBe("OK");
    expect((await createJobShare(job.id, reviewer.id)).kind).toBe("OK");
    expect((await rerunJob(job.id, reviewer.id, "HIGH")).kind).toBe("OK");
    const intent = await createUploadIntent({
      userId: reviewer.id,
      filename: "clip.mp4",
      sizeBytes: 123,
      detailLevel: "MEDIUM",
      workspaceId: wsId,
    });
    expect(intent.kind).toBe("OK");

    // ...and omits jobs:delete and usage:view
    expect((await deleteJob(job.id, reviewer.id)).kind).toBe("FORBIDDEN");
    expect(await usageSummaryForUser(reviewer.id, { workspaceId: wsId })).toBeNull();

    // Reviewer cannot manage custom roles without roles:manage
    asUser(reviewer.id);
    const forbiddenRoleRes = await rolesPost(
      new Request(`http://localhost/api/workspaces/${wsId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Illegal", permissions: ["jobs:delete"] }),
      }),
      { params: Promise.resolve({ id: wsId }) },
    );
    expect(forbiddenRoleRes.status).toBe(403);

    const listedRoles = await rolesGet(
      new Request(`http://localhost/api/workspaces/${wsId}/roles`),
      { params: Promise.resolve({ id: wsId }) },
    );
    expect(listedRoles.status).toBe(200);

    // Deleting custom role cleanly falls back to base VIEWER role
    asUser(owner.id);
    const delRes = await roleDelete(
      new Request(`http://localhost/api/workspaces/${wsId}/roles/${roleBody.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: wsId, roleId: roleBody.id }) },
    );
    expect(delRes.status).toBe(204);
    expect((await renameJob(job.id, reviewer.id, "After delete")).kind).toBe("FORBIDDEN");
  });
});

describe("workspace SCIM 2.0 provisioning", () => {
  it("enforces OWNER token management and full SCIM 2.0 lifecycle + LAST_OWNER + tenant isolation", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const otherWsOwner = await createUser();

    const ws1 = await createWorkspace(owner.id, "Acme Security");
    const ws2 = await createWorkspace(otherWsOwner.id, "Other Tenant");
    if (ws1.kind !== "OK" || ws2.kind !== "OK") throw new Error("expected workspaces");

    await addWorkspaceMember(ws1.workspace.id, owner.id, admin.email, "ADMIN");

    // Non-owner admin cannot manage SCIM tokens
    asUser(admin.id);
    const nonOwnerAttempt = await scimTokensPost(
      new Request(`http://localhost/api/workspaces/${ws1.workspace.id}/scim-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Okta" }),
      }),
      { params: Promise.resolve({ id: ws1.workspace.id }) },
    );
    expect(nonOwnerAttempt.status).toBe(403);

    // Owner generates SCIM bearer token
    asUser(owner.id);
    const tokenRes = await scimTokensPost(
      new Request(`http://localhost/api/workspaces/${ws1.workspace.id}/scim-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Okta Prod" }),
      }),
      { params: Promise.resolve({ id: ws1.workspace.id }) },
    );
    expect(tokenRes.status).toBe(201);
    const { token, tokenRecord } = (await tokenRes.json()) as {
      token: string;
      tokenRecord: { id: string; prefix: string };
    };
    expect(token.startsWith("oc_scim_")).toBe(true);

    const listTokensRes = await scimTokensGet(
      new Request(`http://localhost/api/workspaces/${ws1.workspace.id}/scim-tokens`),
      { params: Promise.resolve({ id: ws1.workspace.id }) },
    );
    expect((await listTokensRes.json()) as unknown[]).toHaveLength(1);

    // ServiceProviderConfig
    const spc = await scimServiceConfigGet();
    expect(spc.status).toBe(200);
    expect(spc.headers.get("content-type")).toContain("application/scim+json");

    // Provision a new user via SCIM 2.0
    const provisionRes = await scimUsersPost(
      new Request("http://localhost/api/scim/v2/Users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/scim+json",
        },
        body: JSON.stringify({
          userName: "provisioned@acme.example",
          displayName: "Provisioned User",
          roles: [{ value: "VIEWER" }],
        }),
      }),
    );
    expect(provisionRes.status).toBe(201);
    const provisioned = (await provisionRes.json()) as {
      id: string;
      userName: string;
      roles: Array<{ value: string }>;
    };
    expect(provisioned.userName).toBe("provisioned@acme.example");
    expect(provisioned.roles[0].value).toBe("VIEWER");

    // Duplicate user returns SCIM 409 conflict
    const dupRes = await scimUsersPost(
      new Request("http://localhost/api/scim/v2/Users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/scim+json",
        },
        body: JSON.stringify({ userName: "provisioned@acme.example" }),
      }),
    );
    expect(dupRes.status).toBe(409);

    // Filter query + Groups endpoint
    const filtered = await scimUsersGet(
      new Request(
        'http://localhost/api/scim/v2/Users?filter=userName%20eq%20%22provisioned@acme.example%22',
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    expect(((await filtered.json()) as { totalResults: number }).totalResults).toBe(1);

    const groups = await scimGroupsGet(
      new Request("http://localhost/api/scim/v2/Groups", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const groupsBody = (await groups.json()) as {
      Resources: Array<{ displayName: string; members: unknown[] }>;
    };
    expect(groupsBody.Resources[0].displayName).toBe("Acme Security");
    expect(groupsBody.Resources[0].members).toHaveLength(3);

    // Cross-tenant isolation: token cannot access ws2 owner
    const crossTenant = await scimUserGet(
      new Request(`http://localhost/api/scim/v2/Users/${otherWsOwner.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: otherWsOwner.id }) },
    );
    expect(crossTenant.status).toBe(404);

    // Sole OWNER cannot be deprovisioned via SCIM DELETE (409)
    const ownerDeleteRes = await scimUserDelete(
      new Request(`http://localhost/api/scim/v2/Users/${owner.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: owner.id }) },
    );
    expect(ownerDeleteRes.status).toBe(409);

    // PATCH promotes VIEWER -> ADMIN, then active=false deprovisions
    const patchRoleRes = await scimUserPatch(
      new Request(`http://localhost/api/scim/v2/Users/${provisioned.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/scim+json",
        },
        body: JSON.stringify({
          Operations: [
            { op: "replace", path: "roles", value: [{ value: "ADMIN" }] },
          ],
        }),
      }),
      { params: Promise.resolve({ id: provisioned.id }) },
    );
    expect(patchRoleRes.status).toBe(200);
    expect(((await patchRoleRes.json()) as { roles: Array<{ value: string }> }).roles[0].value).toBe("ADMIN");

    const deactivateRes = await scimUserPatch(
      new Request(`http://localhost/api/scim/v2/Users/${provisioned.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/scim+json",
        },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ id: provisioned.id }) },
    );
    expect(deactivateRes.status).toBe(200);
    expect(((await deactivateRes.json()) as { active: boolean }).active).toBe(false);

    // Revoking token invalidates future SCIM calls
    asUser(owner.id);
    const revokeRes = await scimTokenDelete(
      new Request(
        `http://localhost/api/workspaces/${ws1.workspace.id}/scim-tokens/${tokenRecord.id}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: ws1.workspace.id, tokenId: tokenRecord.id }) },
    );
    expect(revokeRes.status).toBe(204);

    const postRevoke = await scimUsersGet(
      new Request("http://localhost/api/scim/v2/Users", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(postRevoke.status).toBe(401);
  });
});
