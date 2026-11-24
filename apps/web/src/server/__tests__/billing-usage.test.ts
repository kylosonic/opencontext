import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import {
  analysisPrice,
  recordAnalysisUsage,
  reconcileAnalysisUsage,
} from "@/server/billing/usage";
import { initialStageStates } from "@/server/jobs";
import { createUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analysis usage ledger", () => {
  it("prices timed media and still jobs from opt-in environment rates", () => {
    vi.stubEnv("BILLING_ANALYSIS_MICROS_PER_SECOND", "25");
    vi.stubEnv("BILLING_STILL_JOB_MICROS", "7500");
    expect(analysisPrice({ durationSec: 4, sourceExt: "mp4" })).toEqual({
      quantity: 4,
      unit: "media-second",
      unitCostMicros: 25,
      totalCostMicros: 100,
    });
    expect(analysisPrice({ durationSec: 0, sourceExt: "png" })).toEqual({
      quantity: 1,
      unit: "job",
      unitCostMicros: 7500,
      totalCostMicros: 7500,
    });
  });

  it("writes one idempotent event and updates it without duplication", async () => {
    const user = await createUser();
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "clip.mp4",
        status: "COMPLETED",
        sourceExt: "mp4",
        durationSec: 12,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    vi.stubEnv("BILLING_ANALYSIS_MICROS_PER_SECOND", "10");

    await recordAnalysisUsage(job.id, "COMPLETED");
    await recordAnalysisUsage(job.id, "COMPLETED");

    const rows = await prisma.usageRecord.findMany({ where: { jobId: job.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKey: `analysis:${job.id}`,
      kind: "ANALYSIS",
      quantity: 12,
      totalCostMicros: 120,
    });
  });

  it("reconciles terminal jobs whose best-effort write was missed", async () => {
    const user = await createUser();
    const missed = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "image.png",
        status: "PARTIAL",
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    const queued = await prisma.job.create({
      data: { userId: user.id, displayName: "queued.mp4", status: "QUEUED", stageStates: initialStageStates() },
    });

    expect(await reconcileAnalysisUsage()).toBe(1);
    expect(await prisma.usageRecord.count({ where: { jobId: missed.id } })).toBe(1);
    expect(await prisma.usageRecord.count({ where: { jobId: queued.id } })).toBe(0);
    expect(await reconcileAnalysisUsage()).toBe(0);
  });
});
