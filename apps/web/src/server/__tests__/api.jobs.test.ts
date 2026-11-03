import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * User-facing jobs API — 401/403/404/409/204 paths against the real
 * route handlers with `auth()` mocked (session present/absent).
 */

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { GET as apiJobsGet, POST as apiJobsPost } from "@/app/api/jobs/route";
import {
  GET as apiJobGet,
  DELETE as apiJobDelete,
} from "@/app/api/jobs/[id]/route";
import { POST as apiJobRetry } from "@/app/api/jobs/[id]/retry/route";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { initialStageStates } from "@/server/jobs";
import { createUser, resetDatabase, resetStorage } from "./helpers";

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

  it("POST /api/jobs → 401 without a session", async () => {
    asAnonymous();
    const response = await apiJobsPost(new Request("http://test.local/api/jobs", { method: "POST" }));
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

describe("create + list (POST/GET /api/jobs)", () => {
  it("POST multipart creates a job and returns 201 summary", async () => {
    const user = await createUser();
    asUser(user.id);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "banking demo (final).mp4", { type: "video/mp4" }));
    form.set("detailLevel", "HIGH");
    const request = new Request("http://test.local/api/jobs", {
      method: "POST",
      body: form,
    });

    const response = await apiJobsPost(request);
    expect(response.status).toBe(201);
    const summary = await response.json();
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
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2])], "notes.txt", { type: "text/plain" }));
    const response = await apiJobsPost(
      new Request("http://test.local/api/jobs", { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("FORMAT_UNSUPPORTED");
    expect(await prisma.job.count()).toBe(0);
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
