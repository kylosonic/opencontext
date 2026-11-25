import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { POST as multipartInitPost } from "@/app/api/uploads/multipart/route";
import { GET as uploadStatusGet } from "@/app/api/uploads/[id]/status/route";
import { PUT as uploadChunkPut } from "@/app/api/uploads/[id]/chunks/[partNumber]/route";
import { POST as uploadCompletePost } from "@/app/api/uploads/[id]/complete/route";
import { DELETE as uploadDelete } from "@/app/api/uploads/[id]/route";
import { GET as jobSourceGet } from "@/app/api/jobs/[id]/source/route";
import { prisma } from "@/server/db/prisma";
import { initialStageStates } from "@/server/jobs";
import { resetRateLimits } from "@/server/security/rate-limit";
import { storage } from "@/server/storage";
import { addWorkspaceMember, createWorkspace } from "@/server/workspaces";
import { createUser, resetDatabase, resetStorage } from "./helpers";

function asUser(userId: string): void {
  authMock.auth.mockResolvedValue({ user: { id: userId, name: "Tester" } });
}

function makeFakeMp4(totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
  ]);
  return bytes;
}

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
  resetRateLimits();
  authMock.auth.mockReset();
});

describe("resumable chunked uploads and original source downloads", () => {
  it("supports multipart init, chunk 1, status resume check, chunk 2, and completion", async () => {
    const user = await createUser();
    asUser(user.id);

    const chunkSize = 65_536;
    const totalSize = chunkSize + 4_096;
    const payload = makeFakeMp4(totalSize);

    const initRes = await multipartInitPost(
      new Request("http://localhost/api/uploads/multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "walkthrough.mp4",
          sizeBytes: totalSize,
          mime: "video/mp4",
          detailLevel: "MEDIUM",
          chunkSizeBytes: chunkSize,
        }),
      }),
    );
    expect(initRes.status).toBe(201);
    const { uploadId, totalParts } = (await initRes.json()) as {
      uploadId: string;
      totalParts: number;
    };
    expect(totalParts).toBe(2);

    // Upload only part 1 cleanly
    const part1Res = await uploadChunkPut(
      new Request(`http://localhost/api/uploads/${uploadId}/chunks/1`, {
        method: "PUT",
        body: Buffer.from(payload.subarray(0, chunkSize)),
      }),
      { params: Promise.resolve({ id: uploadId, partNumber: "1" }) },
    );
    expect(part1Res.status).toBe(200);

    // Attempting completion early returns 409 UPLOAD_INCOMPLETE
    const earlyComplete = await uploadCompletePost(
      new Request(`http://localhost/api/uploads/${uploadId}/complete`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(earlyComplete.status).toBe(409);

    // Inspect /status to resume from part 2
    const statusRes = await uploadStatusGet(
      new Request(`http://localhost/api/uploads/${uploadId}/status`),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      uploadedParts: Array<{ partNumber: number }>;
      uploadedBytes: number;
    };
    expect(statusBody.uploadedParts.map((p) => p.partNumber)).toEqual([1]);
    expect(statusBody.uploadedBytes).toBe(chunkSize);

    // Upload part 2 and finalize job
    const part2Res = await uploadChunkPut(
      new Request(`http://localhost/api/uploads/${uploadId}/chunks/2`, {
        method: "PUT",
        body: Buffer.from(payload.subarray(chunkSize)),
      }),
      { params: Promise.resolve({ id: uploadId, partNumber: "2" }) },
    );
    expect(part2Res.status).toBe(200);

    const completeRes = await uploadCompletePost(
      new Request(`http://localhost/api/uploads/${uploadId}/complete`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(completeRes.status).toBe(201);
    const job = (await completeRes.json()) as { id: string; status: string };
    expect(job.status).toBe("QUEUED");

    const stored = await storage.get(`jobs/${job.id}/source.mp4`);
    expect(stored).toEqual(payload);
  });

  it("cleans up staged chunks when cancelling a multipart upload", async () => {
    const user = await createUser();
    asUser(user.id);

    const initRes = await multipartInitPost(
      new Request("http://localhost/api/uploads/multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "abort.mp4",
          sizeBytes: 70_000,
          mime: "video/mp4",
          detailLevel: "LOW",
          chunkSizeBytes: 65_536,
        }),
      }),
    );
    const { uploadId } = (await initRes.json()) as { uploadId: string };
    await uploadChunkPut(
      new Request(`http://localhost/api/uploads/${uploadId}/chunks/1`, {
        method: "PUT",
        body: Buffer.alloc(65_536, 1),
      }),
      { params: Promise.resolve({ id: uploadId, partNumber: "1" }) },
    );

    const delRes = await uploadDelete(
      new Request(`http://localhost/api/uploads/${uploadId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: uploadId }) },
    );
    expect(delRes.status).toBe(204);
    expect(await prisma.uploadIntent.findUnique({ where: { id: uploadId } })).toBeNull();
  });

  it("streams original video and image downloads with sanitized attachment headers while enforcing ACL", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const outsider = await createUser();
    const ws = await createWorkspace(owner.id, "Downloads Team");
    if (ws.kind !== "OK") throw new Error("expected workspace");
    await addWorkspaceMember(ws.workspace.id, owner.id, viewer.email, "VIEWER");

    const job = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: ws.workspace.id,
        displayName: 'sprint/"demo"\\cut',
        status: "COMPLETED",
        sourceExt: "mp4",
        sourceSize: 64,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    const key = `jobs/${job.id}/source.mp4`;
    const bytes = makeFakeMp4(64);
    await storage.put(key, new Blob([Buffer.from(bytes)]).stream(), {
      sizeBytes: 64,
      contentType: "video/mp4",
    });
    await prisma.job.update({ where: { id: job.id }, data: { sourceKey: key } });
    await prisma.media.create({
      data: {
        jobId: job.id,
        kind: "SOURCE",
        key,
        mime: "video/mp4",
        sizeBytes: 64,
        timestampSec: 0,
      },
    });

    // Inline video preview without download=1 stays blocked (direct storage playback only)
    asUser(viewer.id);
    const previewRes = await jobSourceGet(
      new Request(`http://localhost/api/jobs/${job.id}/source`),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(previewRes.status).toBe(404);

    // With download=1, workspace viewer gets the original bytes + attachment header
    const downloadRes = await jobSourceGet(
      new Request(`http://localhost/api/jobs/${job.id}/source?download=1`),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("video/mp4");
    expect(downloadRes.headers.get("content-disposition")).toBe(
      'attachment; filename="sprint--demo--cut.mp4"',
    );
    expect(new Uint8Array(await downloadRes.arrayBuffer())).toEqual(bytes);

    // Non-member receives 403
    asUser(outsider.id);
    const forbiddenRes = await jobSourceGet(
      new Request(`http://localhost/api/jobs/${job.id}/source?download=1`),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(forbiddenRes.status).toBe(403);
  });
});
