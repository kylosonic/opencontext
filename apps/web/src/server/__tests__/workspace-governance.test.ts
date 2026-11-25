import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { usageSummaryForUser } from "@/server/billing/usage";
import { importRemoteUrl } from "@/server/imports/remote";
import {
  deleteJob,
  getJob,
  initialStageStates,
  listJobs,
  renameJob,
  rerunJob,
} from "@/server/jobs";
import { storage } from "@/server/storage";
import { completeUpload, createUploadIntent } from "@/server/uploads";
import {
  acceptWorkspaceInvite,
  addWorkspaceMember,
  createWorkspace,
  createWorkspaceInvite,
  deleteWorkspace,
  hashInviteToken,
  inspectWorkspaceInvite,
  listWorkspaceInvites,
  removeWorkspaceMember,
  renameWorkspace,
  revokeWorkspaceInvite,
  updateWorkspaceMemberRole,
} from "@/server/workspaces";
import { createUser, resetDatabase, resetStorage, TEST_BYTES, testStream } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

async function seedCompletedWorkspaceJob(userId: string, workspaceId: string) {
  const job = await prisma.job.create({
    data: {
      userId,
      workspaceId,
      displayName: "team-demo.mp4",
      status: "COMPLETED",
      sourceExt: "mp4",
      sourceSize: TEST_BYTES.length,
      stageStates: initialStageStates(),
      completedAt: new Date(),
    },
  });
  const key = `jobs/${job.id}/source.mp4`;
  await storage.put(key, testStream(), { sizeBytes: TEST_BYTES.length });
  await prisma.media.create({
    data: {
      jobId: job.id,
      kind: "SOURCE",
      key,
      mime: "video/mp4",
      sizeBytes: TEST_BYTES.length,
      timestampSec: 0,
    },
  });
  await prisma.job.update({ where: { id: job.id }, data: { sourceKey: key } });
  return job;
}

describe("workspace governance & VIEWER RBAC", () => {
  it("gives VIEWER read access while blocking uploads, imports, job mutations, and admin actions", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const created = await createWorkspace(owner.id, "Research Team");
    if (created.kind !== "OK") throw new Error("expected workspace");
    const wsId = created.workspace.id;

    expect(
      (await addWorkspaceMember(wsId, owner.id, viewer.email, "VIEWER")).kind,
    ).toBe("OK");

    const job = await seedCompletedWorkspaceJob(owner.id, wsId);

    const viewResult = await getJob(job.id, viewer.id);
    expect(viewResult.kind).toBe("OK");
    if (viewResult.kind === "OK") {
      expect(viewResult.canManage).toBe(false);
    }
    const list = await listJobs(viewer.id);
    expect(list).toHaveLength(1);
    expect(list[0].canManage).toBe(false);

    expect(await usageSummaryForUser(viewer.id, { workspaceId: wsId })).not.toBeNull();

    const uploadIntent = await createUploadIntent({
      userId: viewer.id,
      workspaceId: wsId,
      filename: "clip.mp4",
      sizeBytes: 128,
      detailLevel: "MEDIUM",
    });
    expect(uploadIntent).toMatchObject({ kind: "INVALID", code: "FORBIDDEN" });

    // Even with a pre-existing UploadIntent row, completeUpload refuses VIEWER.
    const validMp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]);
    await storage.put("incoming/viewer-stale.mp4", new Blob([validMp4]).stream(), {
      sizeBytes: validMp4.length,
    });
    const staleIntent = await prisma.uploadIntent.create({
      data: {
        userId: viewer.id,
        workspaceId: wsId,
        tempKey: "incoming/viewer-stale.mp4",
        filename: "clip.mp4",
        sourceExt: "mp4",
        sizeBytes: validMp4.length,
        mime: "video/mp4",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await completeUpload(staleIntent.id, viewer.id)).toEqual({
      kind: "FORBIDDEN",
    });

    await expect(
      importRemoteUrl({
        userId: viewer.id,
        workspaceId: wsId,
        url: "https://example.com/clip.mp4",
        detailLevel: "MEDIUM",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await renameJob(job.id, viewer.id, "Hacked")).toEqual({
      kind: "FORBIDDEN",
    });
    expect(await rerunJob(job.id, viewer.id, "HIGH")).toEqual({
      kind: "FORBIDDEN",
    });
    expect(await deleteJob(job.id, viewer.id)).toEqual({ kind: "FORBIDDEN" });
    expect(
      (await addWorkspaceMember(wsId, viewer.id, owner.email, "MEMBER")).kind,
    ).toBe("FORBIDDEN");
    expect(
      (await createWorkspaceInvite(wsId, viewer.id, "x@example.com", "VIEWER")).kind,
    ).toBe("FORBIDDEN");
  });

  it("enforces role transitions, last-owner protection, member removal, rename, and delete", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const secondAdmin = await createUser();
    const member = await createUser();
    const created = await createWorkspace(owner.id, "Core Eng");
    if (created.kind !== "OK") throw new Error("expected workspace");
    const wsId = created.workspace.id;

    await addWorkspaceMember(wsId, owner.id, admin.email, "ADMIN");
    await addWorkspaceMember(wsId, owner.id, secondAdmin.email, "ADMIN");
    await addWorkspaceMember(wsId, owner.id, member.email, "MEMBER");

    // ADMIN can manage MEMBER/VIEWER but cannot touch OWNER/ADMIN or promote to OWNER.
    expect(
      (await updateWorkspaceMemberRole(wsId, admin.id, member.id, "VIEWER")).kind,
    ).toBe("OK");
    expect(
      (await updateWorkspaceMemberRole(wsId, admin.id, secondAdmin.id, "MEMBER")).kind,
    ).toBe("FORBIDDEN");
    expect(
      (await updateWorkspaceMemberRole(wsId, admin.id, member.id, "OWNER")).kind,
    ).toBe("FORBIDDEN");

    // Sole OWNER cannot demote self or leave.
    expect(
      (await updateWorkspaceMemberRole(wsId, owner.id, owner.id, "ADMIN")).kind,
    ).toBe("LAST_OWNER");
    expect((await removeWorkspaceMember(wsId, owner.id, owner.id)).kind).toBe(
      "LAST_OWNER",
    );

    // Promote second OWNER so original OWNER can demote or leave safely.
    expect(
      (await updateWorkspaceMemberRole(wsId, owner.id, admin.id, "OWNER")).kind,
    ).toBe("OK");
    expect(
      (await updateWorkspaceMemberRole(wsId, owner.id, owner.id, "ADMIN")).kind,
    ).toBe("OK");

    // Non-owner admin cannot delete team, but can rename team.
    expect(
      (await renameWorkspace(wsId, admin.id, "  Platform   Ops  ")),
    ).toMatchObject({ kind: "OK", workspace: { name: "Platform Ops" } });
    expect((await deleteWorkspace(wsId, member.id)).kind).toBe("FORBIDDEN");
    expect((await deleteWorkspace(wsId, owner.id)).kind).toBe("FORBIDDEN");

    // Member self-remove works; Admin cannot remove another Admin.
    expect((await removeWorkspaceMember(wsId, owner.id, secondAdmin.id)).kind).toBe(
      "FORBIDDEN",
    );
    expect((await removeWorkspaceMember(wsId, member.id, member.id)).kind).toBe(
      "OK",
    );

    // Owner deletes workspace while keeping job alive with workspaceId=null.
    const teamJob = await seedCompletedWorkspaceJob(owner.id, wsId);
    expect((await deleteWorkspace(wsId, admin.id)).kind).toBe("OK");
    const persistedJob = await prisma.job.findUnique({ where: { id: teamJob.id } });
    expect(persistedJob).not.toBeNull();
    expect(persistedJob?.workspaceId).toBeNull();
  });

  it("handles hashed email invites, rotation, email mismatch, revocation, expiry, and atomic accept", async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const wrongUser = await createUser();
    const noEmailUser = await prisma.user.create({
      data: { name: "No Email", githubId: "gh-no-email", githubLogin: "no-email" },
    });

    const created = await createWorkspace(owner.id, "Product Design");
    if (created.kind !== "OK") throw new Error("expected workspace");
    const wsId = created.workspace.id;

    // First invite for invitee -> rotated by second invite.
    const first = await createWorkspaceInvite(wsId, owner.id, invitee.email, "MEMBER");
    expect(first.kind).toBe("OK");
    if (first.kind !== "OK") throw new Error("expected invite");
    const row = await prisma.workspaceInvite.findUnique({ where: { id: first.invite.id } });
    expect(row?.tokenHash).toBe(hashInviteToken(first.token));
    expect(row?.tokenHash).not.toBe(first.token);

    const second = await createWorkspaceInvite(
      wsId,
      owner.id,
      invitee.email.toUpperCase(),
      "VIEWER",
    );
    if (second.kind !== "OK") throw new Error("expected rotated invite");
    expect(await inspectWorkspaceInvite(first.token)).toMatchObject({
      status: "REVOKED",
    });

    const pending = await listWorkspaceInvites(wsId, owner.id);
    expect(pending.kind).toBe("OK");
    if (pending.kind === "OK") {
      expect(pending.invites).toHaveLength(1);
      expect(pending.invites[0].role).toBe("VIEWER");
    }

    // Wrong email & missing email rejected.
    expect(await acceptWorkspaceInvite(second.token, wrongUser.id)).toEqual({
      kind: "EMAIL_MISMATCH",
      expectedEmail: invitee.email.toLowerCase(),
    });
    expect(await acceptWorkspaceInvite(second.token, noEmailUser.id)).toEqual({
      kind: "EMAIL_REQUIRED",
    });

    // Concurrent double-accept succeeds once and returns ACCEPTED for the loser.
    const [r1, r2] = await Promise.all([
      acceptWorkspaceInvite(second.token, invitee.id),
      acceptWorkspaceInvite(second.token, invitee.id),
    ]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["ACCEPTED", "OK"]);

    // Existing member cannot be invited again.
    expect(
      (await createWorkspaceInvite(wsId, owner.id, invitee.email, "ADMIN")).kind,
    ).toBe("ALREADY_MEMBER");

    // Revocation and expiration checks.
    const third = await createWorkspaceInvite(wsId, owner.id, wrongUser.email, "MEMBER");
    if (third.kind !== "OK") throw new Error("expected third invite");
    expect(
      (await revokeWorkspaceInvite(wsId, owner.id, third.invite.id)).kind,
    ).toBe("OK");
    expect((await acceptWorkspaceInvite(third.token, wrongUser.id)).kind).toBe(
      "REVOKED",
    );

    const fourth = await createWorkspaceInvite(wsId, owner.id, wrongUser.email, "MEMBER");
    if (fourth.kind !== "OK") throw new Error("expected fourth invite");
    await prisma.workspaceInvite.update({
      where: { id: fourth.invite.id },
      data: { expiresAt: new Date(Date.now() - 10_000) },
    });
    expect(await inspectWorkspaceInvite(fourth.token)).toMatchObject({
      status: "EXPIRED",
    });
    expect((await acceptWorkspaceInvite(fourth.token, wrongUser.id)).kind).toBe(
      "EXPIRED",
    );
  });
});
