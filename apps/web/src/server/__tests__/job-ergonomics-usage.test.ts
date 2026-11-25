import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { recordAnalysisUsage, usageSummaryForUser } from "@/server/billing/usage";
import {
  deleteJob,
  getJob,
  initialStageStates,
  listJobs,
  renameJob,
  rerunJob,
} from "@/server/jobs";
import { storage } from "@/server/storage";
import { addWorkspaceMember, createWorkspace } from "@/server/workspaces";
import {
  createUser,
  resetDatabase,
  resetStorage,
  TEST_BYTES,
  testStream,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

describe("job rename, re-run, filtered listing, and usage summary", () => {
  it("renames a job cleanly while respecting owner/admin permissions and validation", async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const ws = await createWorkspace(owner.id, "QA Team");
    if (ws.kind !== "OK") throw new Error("expected workspace");
    await addWorkspaceMember(ws.workspace.id, owner.id, admin.email, "ADMIN");
    await addWorkspaceMember(ws.workspace.id, owner.id, member.email, "MEMBER");

    const job = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: ws.workspace.id,
        displayName: "raw-name.mp4",
        status: "COMPLETED",
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });

    expect(await renameJob(job.id, member.id, "Member Edit")).toEqual({
      kind: "FORBIDDEN",
    });
    expect(await renameJob(job.id, owner.id, "   \n  ")).toEqual({
      kind: "INVALID",
    });

    const renamed = await renameJob(
      job.id,
      admin.id,
      "  Checkout\u0007   Walkthrough v2  ",
    );
    expect(renamed.kind).toBe("OK");
    if (renamed.kind === "OK") {
      expect(renamed.job.displayName).toBe("Checkout Walkthrough v2");
      expect(renamed.job.workspaceName).toBe("QA Team");
    }
  });

  it("clones source media for detail-level re-runs so deleting original does not remove new media", async () => {
    const owner = await createUser();
    const ws = await createWorkspace(owner.id, "Design");
    if (ws.kind !== "OK") throw new Error("expected workspace");

    const original = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: ws.workspace.id,
        displayName: "flow-set.png",
        detailLevel: "LOW",
        status: "COMPLETED",
        sourceExt: "png",
        sourceSize: TEST_BYTES.length,
        assetCount: 2,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    const k1 = `jobs/${original.id}/sources/01.png`;
    const k2 = `jobs/${original.id}/sources/02.png`;
    await storage.put(k1, testStream(), { sizeBytes: TEST_BYTES.length, contentType: "image/png" });
    await storage.put(k2, testStream(), { sizeBytes: TEST_BYTES.length, contentType: "image/png" });
    await prisma.media.createMany({
      data: [
        {
          jobId: original.id,
          kind: "SOURCE",
          key: k1,
          mime: "image/png",
          sizeBytes: TEST_BYTES.length,
          timestampSec: 0,
        },
        {
          jobId: original.id,
          kind: "SOURCE",
          key: k2,
          mime: "image/png",
          sizeBytes: TEST_BYTES.length,
          timestampSec: 1,
        },
      ],
    });
    await prisma.job.update({ where: { id: original.id }, data: { sourceKey: k1 } });

    const queuedJob = await prisma.job.create({
      data: {
        userId: owner.id,
        displayName: "active.mp4",
        status: "QUEUED",
        stageStates: initialStageStates(),
      },
    });
    expect(await rerunJob(queuedJob.id, owner.id, "HIGH")).toEqual({
      kind: "NOT_READY",
    });

    const rerun = await rerunJob(original.id, owner.id, "HIGH");
    expect(rerun.kind).toBe("OK");
    if (rerun.kind !== "OK") throw new Error("expected rerun OK");
    expect(rerun.job.status).toBe("QUEUED");
    expect(rerun.job.detailLevel).toBe("HIGH");
    expect(rerun.job.workspaceId).toBe(ws.workspace.id);
    expect(rerun.job.sourceKind).toBe("image");

    const clonedDetail = await getJob(rerun.job.id, owner.id);
    expect(clonedDetail.kind).toBe("OK");
    if (clonedDetail.kind !== "OK") throw new Error("expected detail");
    expect(clonedDetail.job.source?.assets).toHaveLength(2);

    // Deleting the original job deletes its keys, leaving the re-run's copied bytes intact.
    expect(await deleteJob(original.id, owner.id)).toEqual({ kind: "OK" });
    expect(await storage.get(k1)).toBeNull();
    expect(
      await storage.get(clonedDetail.job.source!.assets![0].key),
    ).toEqual(TEST_BYTES);
    expect(
      await storage.get(clonedDetail.job.source!.assets![1].key),
    ).toEqual(TEST_BYTES);

    // Missing source file on disk returns NO_SOURCE.
    await storage.delete(clonedDetail.job.source!.assets![0].key);
    await prisma.job.update({
      where: { id: rerun.job.id },
      data: { status: "FAILED" },
    });
    expect(await rerunJob(rerun.job.id, owner.id, "MEDIUM")).toEqual({
      kind: "NO_SOURCE",
    });
  });

  it("filters listJobs case-insensitively by query, status, scope, and sourceKind", async () => {
    const user = await createUser();
    const ws = await createWorkspace(user.id, "Audio Squad");
    if (ws.kind !== "OK") throw new Error("expected workspace");

    await prisma.job.createMany({
      data: [
        {
          userId: user.id,
          displayName: "Checkout Walkthrough Video",
          status: "COMPLETED",
          sourceExt: "mp4",
          stageStates: initialStageStates(),
        },
        {
          userId: user.id,
          workspaceId: ws.workspace.id,
          displayName: "Standup Recording",
          status: "PARTIAL",
          sourceExt: "mp3",
          stageStates: initialStageStates(),
        },
        {
          userId: user.id,
          workspaceId: ws.workspace.id,
          displayName: "Screen Mockups",
          status: "QUEUED",
          sourceExt: "png",
          stageStates: initialStageStates(),
        },
        {
          userId: user.id,
          displayName: "Design Spec Document",
          status: "FAILED",
          sourceExt: "pdf",
          stageStates: initialStageStates(),
        },
      ],
    });

    const qRes = await listJobs(user.id, { q: "walkthrough" });
    expect(qRes.map((j) => j.displayName)).toEqual(["Checkout Walkthrough Video"]);

    const activeRes = await listJobs(user.id, { status: "ACTIVE" });
    expect(activeRes.map((j) => j.displayName)).toEqual(["Screen Mockups"]);

    const teamRes = await listJobs(user.id, {
      workspaceId: ws.workspace.id,
      sourceKind: "audio",
    });
    expect(teamRes.map((j) => j.displayName)).toEqual(["Standup Recording"]);
    expect(teamRes[0].workspaceName).toBe("Audio Squad");

    const personalRes = await listJobs(user.id, {
      workspaceId: "personal",
      sourceKind: "pdf",
    });
    expect(personalRes.map((j) => j.displayName)).toEqual(["Design Spec Document"]);
  });

  it("aggregates personal and workspace usage summaries and enforces membership", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id, "Billing Team");
    if (ws.kind !== "OK") throw new Error("expected workspace");

    const videoJob = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: ws.workspace.id,
        displayName: "demo.mp4",
        detailLevel: "HIGH",
        status: "COMPLETED",
        sourceExt: "mp4",
        durationSec: 25,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    const pdfJob = await prisma.job.create({
      data: {
        userId: owner.id,
        displayName: "spec.pdf",
        detailLevel: "LOW",
        status: "PARTIAL",
        sourceExt: "pdf",
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });

    await recordAnalysisUsage(videoJob.id, "COMPLETED");
    await recordAnalysisUsage(pdfJob.id, "PARTIAL");

    expect(
      await usageSummaryForUser(outsider.id, { workspaceId: ws.workspace.id }),
    ).toBeNull();

    const personalSummary = await usageSummaryForUser(owner.id, { days: 30 });
    expect(personalSummary).not.toBeNull();
    expect(personalSummary?.totalRecords).toBe(2);
    expect(personalSummary?.totalMediaSeconds).toBe(25);
    expect(personalSummary?.totalStillJobs).toBe(1);
    expect(personalSummary?.byDetailLevel).toEqual({ LOW: 1, MEDIUM: 0, HIGH: 1 });
    expect(personalSummary?.bySourceKind).toMatchObject({ video: 1, pdf: 1 });

    const teamSummary = await usageSummaryForUser(owner.id, {
      workspaceId: ws.workspace.id,
      days: 7,
    });
    expect(teamSummary?.totalRecords).toBe(1);
    expect(teamSummary?.totalMediaSeconds).toBe(25);
    expect(teamSummary?.totalStillJobs).toBe(0);
    expect(teamSummary?.recent[0].jobDisplayName).toBe("demo.mp4");
  });
});
