import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import { initialStageStates, jobToDetail } from "@/server/jobs";
import {
  ACTIVE_JOB_STATUSES,
  isActiveStatus,
  isTerminalStatus,
  jobHeaderView,
  elapsedSeconds,
  stageChecklistView,
  timelineEntriesView,
  buildResultView,
} from "@/server/jobs/jobViews";
import { loadJobResultsData } from "@/server/jobs/loadJobResults";
import type { StageState } from "@opencontext/schemas";
import { createUser, resetDatabase } from "./helpers";

/**
 * Slice 5 view mapping: real job rows → results-shell prop contract.
 * Guards the shape that /app/jobs/[id] renders: stage checklist mapping,
 * header fields, result collections, and the PARTIAL fallback envelope.
 */

function statesWith(...overrides: Partial<StageState>[]): StageState[] {
  return initialStageStates().map((state, index) => ({
    ...state,
    ...(overrides[index] ?? {}),
  }));
}

beforeEach(async () => {
  await resetDatabase();
});

describe("stage checklist mapping (stageStates → shell StageState)", () => {
  it("maps every Prisma StageStatus onto the shell view statuses", () => {
    const view = stageChecklistView(
      statesWith(
        { status: "SUCCEEDED" },
        { status: "RUNNING", progress: 40 },
        { status: "NOT_STARTED" },
        { status: "FAILED" },
        { status: "SKIPPED" },
      ),
    );
    expect(view.map((s) => s.status)).toEqual([
      "done",
      "running",
      "pending",
      "failed",
      "skipped",
    ]);
  });

  it("uses the documented human stage names in pipeline order", () => {
    const view = stageChecklistView(initialStageStates());
    expect(view.map((s) => s.name)).toEqual([
      "Extracting audio and frames",
      "Transcribing speech",
      "Analyzing visual frames",
      "Aggregating context",
      "Generating developer context",
    ]);
  });

  it("renders empty checklist for an empty stageStates array", () => {
    expect(stageChecklistView([])).toEqual([]);
  });
});

describe("status helpers", () => {
  it("classifies the seven processing statuses as active", () => {
    expect(ACTIVE_JOB_STATUSES).toHaveLength(7);
    for (const status of ACTIVE_JOB_STATUSES) {
      expect(isActiveStatus(status)).toBe(true);
      expect(isTerminalStatus(status)).toBe(false);
    }
  });

  it("classifies COMPLETED/PARTIAL/FAILED as terminal", () => {
    for (const status of ["COMPLETED", "PARTIAL", "FAILED"] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(isActiveStatus(status)).toBe(false);
    }
  });
});

describe("header + elapsed mapping", () => {
  it("maps the JobDetail header fields onto JobHeaderView", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "banking demo (final).mp4",
        status: "COMPLETED",
        detailLevel: "HIGH",
        stageStates: initialStageStates(),
        completedAt: new Date("2026-09-02T10:00:00Z"),
        createdAt: new Date("2026-09-02T09:00:00Z"),
      },
    });
    const view = jobHeaderView(jobToDetail(job));
    expect(view).toMatchObject({
      id: job.id,
      displayName: "banking demo (final).mp4",
      status: "COMPLETED",
      detailLevel: "HIGH",
    });
    expect(view.expiresAt).toBeTruthy();
    expect(view.retentionNote).toContain("14 days");
    expect(elapsedSeconds(jobToDetail(job))).toBe(3600);
  });

  it("computes elapsed from updatedAt when completedAt is null", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "partial.mp4",
        status: "PARTIAL",
        stageStates: statesWith({ status: "FAILED" }),
        createdAt: new Date("2026-09-02T09:00:00Z"),
      },
    });
    const fresh = await prisma.job.update({
      where: { id: job.id },
      data: { updatedAt: new Date("2026-09-02T09:00:30Z") },
    });
    expect(elapsedSeconds(jobToDetail(fresh))).toBe(30);
  });
});

describe("timeline entries", () => {
  it("keeps start/end and passes title/summary through", () => {
    const view = timelineEntriesView([
      { start: 0, end: 8, title: "Intro", summary: "Dashboard loads." },
      { start: 8, end: 20, summary: "Send money flow." },
    ]);
    expect(view).toEqual([
      { start: 0, end: 8, title: "Intro", summary: "Dashboard loads." },
      { start: 8, end: 20, title: undefined, summary: "Send money flow." },
    ]);
  });

  it("drops malformed entries and returns [] for non-arrays", () => {
    expect(timelineEntriesView([{ title: "missing bounds" }, "nope", null])).toEqual([]);
    expect(timelineEntriesView(null)).toEqual([]);
    expect(timelineEntriesView(undefined)).toEqual([]);
  });
});

describe("result data loading + buildResultView (COMPLETED)", () => {
  it("loads all collections and prefers the stored ProcessingResult", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "full.mp4",
        status: "COMPLETED",
        detailLevel: "MEDIUM",
        stageStates: initialStageStates().map((s) => ({
          ...s,
          status: "SUCCEEDED",
        })),
        completedAt: new Date("2026-09-02T10:00:00Z"),
        durationSec: 12,
        timeline: [
          { start: 0, end: 8, title: "Intro", summary: "Dashboard." },
        ],
      },
    });
    await prisma.transcriptSegment.createMany({
      data: [
        { jobId: job.id, start: 0, end: 2.5, text: "Welcome." },
        { jobId: job.id, start: 2.5, end: 5, text: "This is the dashboard." },
      ],
    });
    await prisma.visualObservation.create({
      data: {
        jobId: job.id,
        timestampSec: 1,
        certainty: "OBSERVED",
        sceneTitle: "Dashboard",
        visualDescription: "A balance card.",
        uiElements: ["Header", "Balance card"],
        visibleText: [],
        interactions: [],
        designObservations: { layout: "single column" },
        importantChanges: [],
      },
    });
    await prisma.ocrObservation.create({
      data: { jobId: job.id, timestampSec: 1, text: "Balance", confidence: 0.94 },
    });
    await prisma.processingResult.create({
      data: {
        jobId: job.id,
        markdown: "# Context\n\nDemo marker not present.",
        json: { context: "stored", timeline: [] },
        formatVersion: 1,
      },
    });

    const detail = jobToDetail(
      (await prisma.job.findUnique({ where: { id: job.id } }))!,
    );
    const data = await loadJobResultsData(job.id);
    const view = buildResultView(detail, data);

    expect(view.markdown).toContain("# Context");
    expect(view.json).toEqual({ context: "stored", timeline: [] });
    expect(view.formatVersion).toBe(1);
    expect(view.transcript).toEqual([
      { start: 0, end: 2.5, text: "Welcome." },
      { start: 2.5, end: 5, text: "This is the dashboard." },
    ]);
    expect(view.observations).toHaveLength(1);
    expect(view.observations[0]).toMatchObject({
      timestampSec: 1,
      certainty: "OBSERVED",
      sceneTitle: "Dashboard",
      uiElements: ["Header", "Balance card"],
      designObservations: { layout: "single column" },
    });
    expect(view.ocr).toEqual([
      { timestampSec: 1, text: "Balance", confidence: 0.94 },
    ]);
    expect(view.timeline).toEqual([
      { start: 0, end: 8, title: "Intro", summary: "Dashboard." },
    ]);
  });

  it("drops non-string design observations and interaction noise", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "noisy.mp4",
        status: "PARTIAL",
        stageStates: statesWith(
          { status: "SUCCEEDED" },
          { status: "FAILED" },
        ),
      },
    });
    await prisma.visualObservation.create({
      data: {
        jobId: job.id,
        timestampSec: 2,
        certainty: "INFERRED",
        uiElements: ["ok", 42, null, { nested: true }],
        visibleText: [],
        interactions: ["clicks next"],
        designObservations: { color: "#fff", nested: { x: 1 } },
        importantChanges: ["nav changed"],
      },
    });

    const data = await loadJobResultsData(job.id);
    expect(data.observations[0].uiElements).toEqual(["ok"]);
    expect(data.observations[0].designObservations).toEqual({ color: "#fff" });
  });

  it("PARTIAL without ProcessingResult: empty markdown + composed JSON envelope", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "vision-failed.mp4",
        status: "PARTIAL",
        detailLevel: "LOW",
        stageStates: statesWith(
          { status: "SUCCEEDED" },
          { status: "FAILED", error: "vision provider busy" },
        ),
        timeline: [{ start: 0, end: 4, summary: "Intro only." }],
      },
    });
    await prisma.transcriptSegment.create({
      data: { jobId: job.id, start: 0, end: 4, text: "Hello." },
    });

    const detail = jobToDetail(
      (await prisma.job.findUnique({ where: { id: job.id } }))!,
    );
    const data = await loadJobResultsData(job.id);
    const view = buildResultView(detail, data);

    expect(view.markdown).toBe("");
    expect(view.transcript).toEqual([{ start: 0, end: 4, text: "Hello." }]);
    expect(view.timeline).toEqual([
      { start: 0, end: 4, title: undefined, summary: "Intro only." },
    ]);
    const envelope = view.json as Record<string, unknown>;
    expect(envelope.markdown).toBe("");
    expect((envelope.metadata as Record<string, unknown>).id).toBe(job.id);
    expect((envelope.transcript as unknown[]).length).toBe(1);
    expect(view.observations).toEqual([]);
    expect(view.ocr).toEqual([]);
  });
});
