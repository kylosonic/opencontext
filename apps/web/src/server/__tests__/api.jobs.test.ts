import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * User-facing jobs API — 401/403/404/409/204 paths against the real
 * route handlers with `auth()` mocked (session present/absent).
 */

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { GET as apiJobsGet } from "@/app/api/jobs/route";
import { POST as uploadsPost } from "@/app/api/uploads/route";
import { DELETE as uploadDelete } from "@/app/api/uploads/[id]/route";
import { PUT as uploadBodyPut } from "@/app/api/uploads/[id]/body/route";
import { POST as uploadCompletePost } from "@/app/api/uploads/[id]/complete/route";
import {
  GET as apiJobGet,
  DELETE as apiJobDelete,
} from "@/app/api/jobs/[id]/route";
import { POST as apiJobRetry } from "@/app/api/jobs/[id]/retry/route";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { initialStageStates } from "@/server/jobs";
import { createUser, resetDatabase, resetStorage } from "./helpers";
import { resetRateLimits } from "@/server/security/rate-limit";

function asUser(userId: string): void {
  authMock.auth.mockResolvedValue({ user: { id: userId, name: "Test User" } });
}
function asAnonymous(): void {
  authMock.auth.mockResolvedValue(null);
}

async function makeJob(
  userId: string,
  data: Record<string, unknown> = {},
): Promise<string> {
  const job = await prisma.job.create({
    data: {
      userId,
      displayName: "sample.mp4",
      status: "QUEUED",
      stageStates: initialStageStates(),
      ...data,
    },
  });
  return job.id;
}

function jobUrl(jobId: string, suffix = ""): string {
  return `http://test.local/api/jobs/${jobId}${suffix}`;
}

beforeEach(async () => {
  authMock.auth.mockReset();
  await resetDatabase();
  await resetStorage();
  await resetRateLimits();
});

describe("401 — anonymous callers", () => {
  it("GET /api/jobs → 401 UNAUTHORIZED envelope", async () => {
    asAnonymous();
    const response = await apiJobsGet();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Sign in required" },
    });
  });

  it("POST /api/uploads → 401 without a session", async () => {
    asAnonymous();
    const response = await uploadsPost(
      new Request("http://test.local/api/uploads", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("GET /api/jobs/[id] → 401 without a session", async () => {
    asAnonymous();
    const user = await createUser();
    const jobId = await makeJob(user.id);
    const response = await apiJobGet(
      new Request(jobUrl(jobId)),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("direct upload + list", () => {
  it("intent → local PUT → complete creates a queued job", async () => {
    const user = await createUser();
    asUser(user.id);

    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "banking demo (final).mp4",
          sizeBytes: 4,
          mime: "video/mp4",
          detailLevel: "HIGH",
        }),
      }),
    );
    expect(intentResponse.status).toBe(201);
    const intent = (await intentResponse.json()) as {
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(intent.url).toBe(`/api/uploads/${intent.uploadId}/body`);

    const putResponse = await uploadBodyPut(
      new Request(`http://test.local${intent.url}`, {
        method: "PUT",
        headers: {
          "Content-Type": intent.headers["Content-Type"],
          "Content-Length": "4",
        },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(putResponse.status).toBe(204);

    const completeResponse = await uploadCompletePost(
      new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(completeResponse.status).toBe(201);
    const summary = await completeResponse.json();
    expect(summary.id).toBeTruthy();
    expect(summary.displayName).toBe("banking demo (final).mp4");
    expect(summary.status).toBe("QUEUED");
    expect(summary.detailLevel).toBe("HIGH");

    const row = await prisma.job.findUnique({ where: { id: summary.id } });
    expect(row?.sourceKey).toBe(`jobs/${summary.id}/source.mp4`);
    expect(await storage.get(row?.sourceKey as string)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("POST rejects an unsupported format with 400 FORMAT_UNSUPPORTED", async () => {
    const user = await createUser();
    asUser(user.id);
    const response = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "notes.txt",
          sizeBytes: 2,
          mime: "text/plain",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("FORMAT_UNSUPPORTED");
    expect(await prisma.job.count()).toBe(0);
  });

  it("returns Retry-After when the upload-intent quota is exhausted", async () => {
    const user = await createUser();
    asUser(user.id);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await uploadsPost(
        new Request("http://test.local/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: `attempt-${attempt}.mp4`,
            sizeBytes: 4,
            mime: "video/mp4",
          }),
        }),
      );
      expect(response.status).toBe(201);
    }

    const blocked = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "blocked.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("complete rejects a missing object with 409 UPLOAD_INCOMPLETE", async () => {
    const user = await createUser();
    asUser(user.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "missing.mp4",
          sizeBytes: 5,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();
    const response = await uploadCompletePost(
      new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("UPLOAD_INCOMPLETE");
  });

  it("non-owner cannot upload into or complete another user's intent", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    asUser(owner.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "owned.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();

    asUser(intruder.id);
    const putResponse = await uploadBodyPut(
      new Request(`http://test.local${intent.url}`, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(putResponse.status).toBe(403);
    const completeResponse = await uploadCompletePost(
      new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(completeResponse.status).toBe(403);
  });

  it("owner can cancel an uploaded intent, remove its object, and start another", async () => {
    const user = await createUser();
    asUser(user.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "cancel-me.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();
    const putResponse = await uploadBodyPut(
      new Request(`http://test.local${intent.url}`, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(putResponse.status).toBe(204);
    const row = await prisma.uploadIntent.findUnique({ where: { id: intent.uploadId } });
    expect(await storage.head(row?.tempKey as string)).not.toBeNull();

    const cancelResponse = await uploadDelete(
      new Request(`http://test.local/api/uploads/${intent.uploadId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(cancelResponse.status).toBe(204);
    expect(await storage.head(row?.tempKey as string)).toBeNull();
    expect(await prisma.uploadIntent.findUnique({ where: { id: intent.uploadId } })).toBeNull();
    expect(await prisma.job.count()).toBe(0);

    const nextResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "next.mp4",
          sizeBytes: 2,
          mime: "video/mp4",
        }),
      }),
    );
    expect(nextResponse.status).toBe(201);
  });

  it("non-owner cannot cancel another user's intent", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    asUser(owner.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "owned.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();

    asUser(intruder.id);
    const response = await uploadDelete(
      new Request(`http://test.local/api/uploads/${intent.uploadId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(response.status).toBe(403);
    expect(
      await prisma.uploadIntent.findUnique({ where: { id: intent.uploadId } }),
    ).not.toBeNull();
  });

  it("rejects an expired intent with 410 UPLOAD_EXPIRED", async () => {
    const user = await createUser();
    asUser(user.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "expired.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();
    await prisma.uploadIntent.update({
      where: { id: intent.uploadId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await uploadCompletePost(
      new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe("UPLOAD_EXPIRED");
  });

  it("rejects a local body whose byte count differs from the intent", async () => {
    const user = await createUser();
    asUser(user.id);
    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "short.mp4",
          sizeBytes: 4,
          mime: "video/mp4",
        }),
      }),
    );
    const intent = await intentResponse.json();
    const response = await uploadBodyPut(
      new Request(`http://test.local${intent.url}`, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "3",
        },
        body: new Uint8Array([1, 2, 3]),
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("UPLOAD_INCOMPLETE");
  });

  it("rejects a declared MIME type that disagrees with the extension", async () => {
    const user = await createUser();
    asUser(user.id);
    const response = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "video.mp4",
          sizeBytes: 10,
          mime: "video/webm",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("do not match");
  });

  it("GET lists only the caller's jobs, newest first", async () => {
    const owner = await createUser();
    const other = await createUser();
    const first = await makeJob(owner.id, { displayName: "old.mp4" });
    await prisma.job.update({
      where: { id: first },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await makeJob(owner.id, { displayName: "new.mp4" });
    await makeJob(other.id, { displayName: "theirs.mp4" });

    asUser(owner.id);
    const response = await apiJobsGet();
    expect(response.status).toBe(200);
    const list = await response.json();
    expect(list.map((job: { displayName: string }) => job.displayName)).toEqual([
      "new.mp4",
      "old.mp4",
    ]);
  });
});

describe("GET /api/jobs/[id] — ownership (identity.md B4)", () => {
  it("owner sees the full state", async () => {
    const user = await createUser();
    const jobId = await makeJob(user.id);
    asUser(user.id);
    const response = await apiJobGet(
      new Request(jobUrl(jobId)),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(jobId);
    expect(body.stageStates).toHaveLength(5);
    expect(body.expiresAt).toBeTruthy();
    expect(body.retentionNote).toContain("kept for");
  });

  it("non-owner → 403 FORBIDDEN, never the content", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const jobId = await makeJob(owner.id);
    asUser(intruder.id);
    const response = await apiJobGet(
      new Request(jobUrl(jobId)),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("deleted job → 404 NOT_FOUND (jobs.md B10)", async () => {
    const user = await createUser();
    asUser(user.id);
    const response = await apiJobGet(
      new Request(jobUrl("nonexistent")),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/jobs/[id] (jobs.md B10)", () => {
  it("owner deletes → 204, storage removed, then 404", async () => {
    const user = await createUser();
    const jobId = await makeJob(user.id, {
      sourceKey: "jobs/x/source.mp4",
      sourceExt: "mp4",
      sourceSize: 4,
    });
    await storage.put("jobs/x/source.mp4", new Blob([new Uint8Array([1, 2, 3, 4])]).stream(), {
      sizeBytes: 4,
    });

    asUser(user.id);
    const response = await apiJobDelete(
      new Request(jobUrl(jobId), { method: "DELETE" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(204);
    expect(await prisma.job.count()).toBe(0);
    expect(await storage.get("jobs/x/source.mp4")).toBeNull();

    const again = await apiJobDelete(
      new Request(jobUrl(jobId), { method: "DELETE" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(again.status).toBe(404);
  });

  it("non-owner delete → 403", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const jobId = await makeJob(owner.id);
    asUser(intruder.id);
    const response = await apiJobDelete(
      new Request(jobUrl(jobId), { method: "DELETE" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/jobs/[id]/retry (jobs.md B5/B6)", () => {
  it("409 RETRY_NOT_ALLOWED for a QUEUED job", async () => {
    const user = await createUser();
    const jobId = await makeJob(user.id);
    asUser(user.id);
    const response = await apiJobRetry(
      new Request(jobUrl(jobId, "/retry"), { method: "POST" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("RETRY_NOT_ALLOWED");
  });

  it("409 for FAILED + PERMANENT (no retry can help, B6)", async () => {
    const user = await createUser();
    const jobId = await makeJob(user.id, {
      status: "FAILED",
      failureKind: "PERMANENT",
      error: "This file is not a valid video",
    });
    asUser(user.id);
    const response = await apiJobRetry(
      new Request(jobUrl(jobId, "/retry"), { method: "POST" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(409);
  });

  it("200 for PARTIAL: failed stages reset, succeeded stages untouched", async () => {
    const user = await createUser();
    const stageStates = [
      { stage: "EXTRACTING", status: "SUCCEEDED", attempt: 1 },
      { stage: "TRANSCRIBING", status: "SUCCEEDED", attempt: 1 },
      { stage: "ANALYZING", status: "FAILED", attempt: 1, error: "vision down" },
      { stage: "AGGREGATING", status: "NOT_STARTED", attempt: 0 },
      { stage: "GENERATING_CONTEXT", status: "NOT_STARTED", attempt: 0 },
    ];
    const jobId = await makeJob(user.id, {
      status: "PARTIAL",
      failureKind: "TRANSIENT",
      error: "vision down",
      errorStage: "ANALYZING",
      retryCount: 0,
      stageStates,
    });
    await prisma.transcriptSegment.create({
      data: { jobId, start: 0, end: 1, text: "kept transcript" },
    });

    asUser(user.id);
    const response = await apiJobRetry(
      new Request(jobUrl(jobId, "/retry"), { method: "POST" }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("QUEUED");
    expect(body.retryCount).toBe(1);
    expect(body.error).toBeNull();
    expect(body.failureKind).toBe("NONE");

    const byStage = new Map(
      (body.stageStates as { stage: string; status: string }[]).map((s) => [s.stage, s.status]),
    );
    expect(byStage.get("EXTRACTING")).toBe("SUCCEEDED");
    expect(byStage.get("TRANSCRIBING")).toBe("SUCCEEDED");
    expect(byStage.get("ANALYZING")).toBe("NOT_STARTED");
    expect(byStage.get("AGGREGATING")).toBe("NOT_STARTED");
    expect(byStage.get("GENERATING_CONTEXT")).toBe("NOT_STARTED");

    // Completed-stage data survives the retry (B5: transcript not regenerated).
    const segments = await prisma.transcriptSegment.findMany({ where: { jobId } });
    expect(segments).toHaveLength(1);
  });
});
