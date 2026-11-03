import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { PATCH as patchEvidenceReview } from "@/app/api/jobs/[id]/evidence/[evidenceId]/route";
import { prisma } from "@/server/db/prisma";
import { createQueuedJob, createUser, resetDatabase, resetStorage } from "./helpers";

const evidenceRecord = {
  id: 1,
  kind: "VISUAL",
  timestampSec: 12,
  certainty: "OBSERVED",
  text: "A save button is visible.",
  source: { collection: "visualFindings", index: 0 },
};

async function makeReviewableResult(userId: string): Promise<string> {
  const job = await createQueuedJob(userId, "review-me.mp4");
  await prisma.job.update({
    where: { id: job.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await prisma.processingResult.create({
    data: {
      jobId: job.id,
      markdown: "# Context\n\n- A save button is visible. [E0001 · 00:12 · Observed]",
      json: { evidenceVersion: 1, evidence: [evidenceRecord] },
      formatVersion: 2,
    },
  });
  return job.id;
}

function reviewRequest(
  jobId: string,
  evidenceId = "1",
  body: unknown = { status: "CONFIRMED", note: "Checked against the source." },
): Request {
  return new Request(
    `http://test.local/api/jobs/${jobId}/evidence/${evidenceId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function patch(jobId: string, evidenceId?: string, body?: unknown) {
  return patchEvidenceReview(reviewRequest(jobId, evidenceId, body), {
    params: Promise.resolve({ id: jobId, evidenceId: evidenceId ?? "1" }),
  });
}

beforeEach(async () => {
  authMock.auth.mockReset();
  await resetDatabase();
  await resetStorage();
});

describe("PATCH /api/jobs/[id]/evidence/[evidenceId]", () => {
  it("persists the review without replacing the original claim", async () => {
    const user = await createUser();
    const jobId = await makeReviewableResult(user.id);
    authMock.auth.mockResolvedValue({ user: { id: user.id } });

    const response = await patch(jobId, "1", {
      status: "FLAGGED",
      note: "The label is partially obscured.",
      correctedText: "A partially obscured save button is visible.",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.json.evidence[0].text).toBe(evidenceRecord.text);
    expect(body.json.evidence[0].review).toMatchObject({
      status: "FLAGGED",
      note: "The label is partially obscured.",
      correctedText: "A partially obscured save button is visible.",
    });
    expect(body.json.evidence[0].review.reviewedAt).toBeTruthy();
    expect(body.markdown).toContain("## Human review");
    expect(body.markdown).toContain("Suggested correction (original claim retained)");

    const stored = await prisma.processingResult.findUnique({ where: { jobId } });
    expect(stored?.markdown).toBe(body.markdown);
    expect(stored?.json).toEqual(body.json);
  });

  it("clears the review annotation and generated appendix", async () => {
    const user = await createUser();
    const jobId = await makeReviewableResult(user.id);
    authMock.auth.mockResolvedValue({ user: { id: user.id } });
    await patch(jobId, "1", { status: "CONFIRMED" });

    const response = await patch(jobId, "1", { status: "UNREVIEWED" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.json.evidence[0].review).toBeUndefined();
    expect(body.markdown).not.toContain("## Human review");
    expect(body.markdown).toContain(evidenceRecord.text);
  });

  it("requires an authenticated owner", async () => {
    const user = await createUser();
    const otherUser = await createUser();
    const jobId = await makeReviewableResult(user.id);

    authMock.auth.mockResolvedValue(null);
    expect((await patch(jobId)).status).toBe(401);

    authMock.auth.mockResolvedValue({ user: { id: otherUser.id } });
    expect((await patch(jobId)).status).toBe(403);
  });

  it("rejects invalid updates and unknown evidence ids", async () => {
    const user = await createUser();
    const jobId = await makeReviewableResult(user.id);
    authMock.auth.mockResolvedValue({ user: { id: user.id } });

    expect(
      (await patch(jobId, "1", { status: "CONFIRMED", correctedText: "Contradictory" }))
        .status,
    ).toBe(400);
    expect((await patch(jobId, "999")).status).toBe(404);
    expect((await patch(jobId, "not-a-number")).status).toBe(400);
  });
});
