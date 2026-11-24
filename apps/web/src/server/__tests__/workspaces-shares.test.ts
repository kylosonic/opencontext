import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { getJob, initialStageStates } from "@/server/jobs";
import {
  activeJobShare,
  createJobShare,
  getSharedJob,
  jobShareStatus,
  revokeJobShares,
  SHARE_TOKEN_RE,
} from "@/server/jobs/shares";
import {
  addWorkspaceMember,
  canAccessWorkspace,
  createWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  workspaceRole,
} from "@/server/workspaces";
import { completeUpload, createUploadIntent } from "@/server/uploads";
import { storage } from "@/server/storage";
import { resetDatabase, createUser, resetStorage } from "./helpers";

const VALID_MP4_PREFIX = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
]);

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

async function completedJob(userId: string, workspaceId?: string) {
  return prisma.job.create({
    data: {
      userId,
      workspaceId: workspaceId ?? null,
      displayName: "sample.mp4",
      status: "COMPLETED",
      stageStates: initialStageStates(),
      completedAt: new Date(),
    },
  });
}

describe("workspace membership", () => {
  it("creates an owned team and reports the owner role", async () => {
    const owner = await createUser();
    const created = await createWorkspace(owner.id, "  Product   Ops  ");
    expect(created.kind).toBe("OK");
    if (created.kind !== "OK") return;

    expect(created.workspace.name).toBe("Product Ops");
    expect(await workspaceRole(created.workspace.id, owner.id)).toBe("OWNER");
    expect(await canAccessWorkspace(created.workspace.id, owner.id)).toBe(true);

    const summaries = await listWorkspaces(owner.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ name: "Product Ops", role: "OWNER", memberCount: 1 });
  });

  it("rejects blank and oversized team names", async () => {
    const owner = await createUser();
    expect((await createWorkspace(owner.id, "   ")).kind).toBe("INVALID");
    expect((await createWorkspace(owner.id, "x".repeat(81))).kind).toBe("INVALID");
  });

  it("lets an admin add an existing user but not a plain member", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    const ws = created.workspace.id;

    expect((await addWorkspaceMember(ws, owner.id, admin.email, "ADMIN")).kind).toBe("OK");
    expect((await addWorkspaceMember(ws, owner.id, member.email, "MEMBER")).kind).toBe("OK");

    // A MEMBER cannot invite, even a valid existing user.
    expect((await addWorkspaceMember(ws, member.id, outsider.email, "MEMBER")).kind).toBe(
      "FORBIDDEN",
    );
    // An ADMIN can.
    expect((await addWorkspaceMember(ws, admin.id, outsider.email, "MEMBER")).kind).toBe("OK");
  });

  it("reports unknown users and duplicate membership without leaking", async () => {
    const owner = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    const ws = created.workspace.id;

    expect((await addWorkspaceMember(ws, owner.id, "nobody@example.com", "MEMBER")).kind).toBe(
      "USER_NOT_FOUND",
    );
    expect((await addWorkspaceMember(ws, owner.id, owner.email, "MEMBER")).kind).toBe(
      "ALREADY_MEMBER",
    );
    // Non-members get NOT_FOUND, not FORBIDDEN, so team ids are unenumerable.
    const outsider = await createUser();
    expect((await addWorkspaceMember(ws, outsider.id, owner.email, "MEMBER")).kind).toBe(
      "NOT_FOUND",
    );
  });

  it("hides member lists from non-members", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    const ws = created.workspace.id;

    expect(await listWorkspaceMembers(ws, outsider.id)).toBeNull();
    const members = await listWorkspaceMembers(ws, owner.id);
    expect(members).toHaveLength(1);
    expect(members?.[0]?.role).toBe("OWNER");
  });
});

describe("team-scoped job access", () => {
  it("grants team members access and denies outsiders", async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    await addWorkspaceMember(created.workspace.id, owner.id, member.email, "MEMBER");
    const job = await completedJob(owner.id, created.workspace.id);

    expect((await getJob(job.id, owner.id)).kind).toBe("OK");
    expect((await getJob(job.id, member.id)).kind).toBe("OK");
    expect((await getJob(job.id, outsider.id)).kind).toBe("FORBIDDEN");
  });

  it("treats personal jobs as owner-only", async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    await addWorkspaceMember(created.workspace.id, owner.id, member.email, "MEMBER");
    const personal = await completedJob(owner.id);

    expect((await getJob(personal.id, member.id)).kind).toBe("FORBIDDEN");
  });

  it("rechecks team membership before committing an uploaded job", async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    const ws = created.workspace.id;
    await addWorkspaceMember(ws, owner.id, member.email, "MEMBER");

    const intent = await createUploadIntent({
      userId: member.id,
      filename: "team-clip.mp4",
      sizeBytes: VALID_MP4_PREFIX.byteLength,
      mime: "video/mp4",
      detailLevel: "MEDIUM",
      workspaceId: ws,
    });
    expect(intent.kind).toBe("OK");
    if (intent.kind !== "OK") return;
    const row = await prisma.uploadIntent.findUniqueOrThrow({
      where: { id: intent.uploadId },
    });
    await storage.put(row.tempKey, new Blob([VALID_MP4_PREFIX]).stream(), {
      sizeBytes: VALID_MP4_PREFIX.byteLength,
      contentType: "video/mp4",
    });

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: ws, userId: member.id } },
    });

    await expect(completeUpload(intent.uploadId, member.id)).resolves.toEqual({
      kind: "FORBIDDEN",
    });
    expect(await prisma.job.count()).toBe(0);
    expect(
      (await prisma.uploadIntent.findUniqueOrThrow({ where: { id: row.id } })).claimedAt,
    ).toBeNull();
  });
});

describe("public share links", () => {
  it("issues a single-use raw token and stores only its hash", async () => {
    const owner = await createUser();
    const job = await completedJob(owner.id);
    const result = await createJobShare(job.id, owner.id);
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") return;

    expect(result.token).toMatch(SHARE_TOKEN_RE);
    expect(result.token.length).toBe(43);
    // The stored row must never contain the raw bearer token.
    const row = await prisma.jobShare.findUniqueOrThrow({ where: { id: result.share.id } });
    expect(row.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(row)).not.toContain(result.token);

    const shared = await getSharedJob(result.token);
    expect(shared?.job.id).toBe(job.id);
  });

  it("refuses to share a job the caller cannot access", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const job = await completedJob(owner.id);

    expect((await createJobShare(job.id, outsider.id)).kind).toBe("FORBIDDEN");
    await expect(createJobShare("missing-job", owner.id)).resolves.toMatchObject({
      kind: "NOT_FOUND",
    });
  });

  it("only lets the job owner or a team administrator create and revoke links", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const created = await createWorkspace(owner.id, "Team");
    if (created.kind !== "OK") throw new Error("workspace setup failed");
    await addWorkspaceMember(created.workspace.id, owner.id, admin.email, "ADMIN");
    await addWorkspaceMember(created.workspace.id, owner.id, member.email, "MEMBER");
    const job = await completedJob(owner.id, created.workspace.id);

    expect((await createJobShare(job.id, member.id)).kind).toBe("FORBIDDEN");
    expect((await revokeJobShares(job.id, member.id)).kind).toBe("FORBIDDEN");
    expect((await createJobShare(job.id, admin.id)).kind).toBe("OK");
    expect((await revokeJobShares(job.id, admin.id)).kind).toBe("OK");
  });

  it("refuses to share a job that has not finished processing", async () => {
    const owner = await createUser();
    const job = await prisma.job.create({
      data: { userId: owner.id, displayName: "x.mp4", status: "ANALYZING", stageStates: initialStageStates() },
    });
    expect((await createJobShare(job.id, owner.id)).kind).toBe("NOT_READY");
  });

  it("rotates links so only the newest token resolves", async () => {
    const owner = await createUser();
    const job = await completedJob(owner.id);
    const first = await createJobShare(job.id, owner.id);
    const second = await createJobShare(job.id, owner.id);
    if (first.kind !== "OK" || second.kind !== "OK") throw new Error("share setup failed");

    await expect(getSharedJob(first.token)).resolves.toBeNull();
    await expect(getSharedJob(second.token)).resolves.not.toBeNull();
    expect(await prisma.jobShare.count({ where: { jobId: job.id, revokedAt: null } })).toBe(1);
  });

  it("revokes every active link", async () => {
    const owner = await createUser();
    const job = await completedJob(owner.id);
    const created = await createJobShare(job.id, owner.id);
    if (created.kind !== "OK") throw new Error("share setup failed");

    expect((await revokeJobShares(job.id, owner.id)).kind).toBe("OK");
    await expect(getSharedJob(created.token)).resolves.toBeNull();
    expect(await activeJobShare(job.id)).toBeNull();
  });

  it("rejects malformed, unknown, and expired tokens identically", async () => {
    const owner = await createUser();
    const job = await completedJob(owner.id);
    const created = await createJobShare(job.id, owner.id);
    if (created.kind !== "OK") throw new Error("share setup failed");

    await expect(getSharedJob("short")).resolves.toBeNull();
    await expect(getSharedJob("a".repeat(43))).resolves.toBeNull();

    await prisma.jobShare.update({
      where: { id: created.share.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(getSharedJob(created.token)).resolves.toBeNull();
  });

  it("stops resolving when the job is deleted", async () => {
    const owner = await createUser();
    const job = await completedJob(owner.id);
    const created = await createJobShare(job.id, owner.id);
    if (created.kind !== "OK") throw new Error("share setup failed");

    await prisma.job.delete({ where: { id: job.id } });
    await expect(getSharedJob(created.token)).resolves.toBeNull();
  });

  it("reports status only to callers with access", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const job = await completedJob(owner.id);

    expect(await jobShareStatus(job.id, owner.id)).toEqual({ kind: "OK", share: null });
    const created = await createJobShare(job.id, owner.id);
    if (created.kind !== "OK") throw new Error("share setup failed");
    expect(await jobShareStatus(job.id, owner.id)).toMatchObject({ kind: "OK" });
    expect((await jobShareStatus(job.id, outsider.id)).kind).toBe("FORBIDDEN");
  });
});
