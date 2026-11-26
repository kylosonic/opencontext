import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { retentionSweep } from "@/server/queue";
import { initialStageStates } from "@/server/jobs";
import { createUser, resetDatabase, resetStorage, TEST_BYTES } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

async function makeJob(
  userId: string,
  createdAt: Date,
  completedAt: Date | null,
) {
  return prisma.job.create({
    data: {
      userId,
      displayName: "expiry.mp4",
      status: completedAt ? "COMPLETED" : "FAILED",
      stageStates: initialStageStates(),
      createdAt,
      completedAt,
      sourceKey: null,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

describe("retentionSweep (jobs.md B9)", () => {
  it("honors configurable retention windows", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 4 * DAY), null);
    const previous = process.env.RETENTION_INCOMPLETE_DAYS;
    process.env.RETENTION_INCOMPLETE_DAYS = "3";
    try {
      const result = await retentionSweep();
      expect(result.deleted).toBe(1);
      expect(await prisma.job.count()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.RETENTION_INCOMPLETE_DAYS;
      else process.env.RETENTION_INCOMPLETE_DAYS = previous;
    }
  });

  it("deletes completed jobs older than 14 days", async () => {
    const user = await createUser();
    const stale = await makeJob(
      user.id,
      new Date(Date.now() - 15 * DAY),
      new Date(Date.now() - 14.5 * DAY),
    );
    await prisma.job.update({
      where: { id: stale.id },
      data: { sourceKey: `jobs/${stale.id}/source.mp4` },
    });
    await storage.put(
      `jobs/${stale.id}/source.mp4`,
      new Blob([TEST_BYTES]).stream(),
      {
        sizeBytes: TEST_BYTES.length,
      },
    );

    const result = await retentionSweep();
    expect(result.deleted).toBe(1);
    expect(await prisma.job.count()).toBe(0);
    expect(await storage.get(`jobs/${stale.id}/source.mp4`)).toBeNull();
  });

  it("keeps completed jobs younger than 14 days", async () => {
    const user = await createUser();
    await makeJob(
      user.id,
      new Date(Date.now() - 10 * DAY),
      new Date(Date.now() - 9 * DAY),
    );
    const result = await retentionSweep();
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.job.count()).toBe(1);
  });

  it("deletes unfinished jobs older than 7 days", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 8 * DAY), null);
    const result = await retentionSweep();
    expect(result.deleted).toBe(1);
    expect(await prisma.job.count()).toBe(0);
  });

  it("keeps unfinished jobs younger than 7 days", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 3 * DAY), null);
    const result = await retentionSweep();
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.job.count()).toBe(1);
  });

  it("is idempotent — a second sweep finds nothing", async () => {
    const user = await createUser();
    await makeJob(user.id, new Date(Date.now() - 20 * DAY), null);
    const first = await retentionSweep();
    const second = await retentionSweep();
    expect(first.deleted).toBe(1);
    expect(second).toEqual({ scanned: 0, deleted: 0 });
  });

  it("removes expired upload intents and their temporary objects", async () => {
    const user = await createUser();
    const tempKey = "incoming/expired.mp4";
    await storage.put(tempKey, new Blob([TEST_BYTES]).stream(), {
      sizeBytes: TEST_BYTES.length,
    });
    await prisma.uploadIntent.create({
      data: {
        userId: user.id,
        tempKey,
        filename: "expired.mp4",
        sourceExt: "mp4",
        sizeBytes: TEST_BYTES.length,
        mime: "video/mp4",
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const result = await retentionSweep();
    expect(result.deleted).toBe(1);
    expect(await prisma.uploadIntent.count()).toBe(0);
    expect(await storage.get(tempKey)).toBeNull();
  });

  it("removes long-expired rate-limit buckets", async () => {
    await prisma.rateLimitBucket.create({
      data: {
        key: "expired",
        count: 1,
        resetAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await prisma.rateLimitBucket.create({
      data: {
        key: "active",
        count: 1,
        resetAt: new Date(Date.now() + DAY),
      },
    });

    await retentionSweep();
    expect(
      await prisma.rateLimitBucket.findUnique({ where: { key: "expired" } }),
    ).toBeNull();
    expect(
      await prisma.rateLimitBucket.findUnique({ where: { key: "active" } }),
    ).not.toBeNull();
  });

  it("keeps recent Stripe event IDs while pruning stale deduplication rows", async () => {
    await prisma.stripeWebhookEvent.createMany({
      data: [
        {
          id: "evt_recent",
          type: "customer.subscription.updated",
          livemode: false,
          processedAt: new Date(Date.now() - 10 * DAY),
        },
        {
          id: "evt_stale",
          type: "customer.subscription.updated",
          livemode: false,
          processedAt: new Date(Date.now() - 31 * DAY),
        },
      ],
    });

    await retentionSweep();
    expect(
      await prisma.stripeWebhookEvent.findUnique({
        where: { id: "evt_recent" },
      }),
    ).not.toBeNull();
    expect(
      await prisma.stripeWebhookEvent.findUnique({
        where: { id: "evt_stale" },
      }),
    ).toBeNull();
  });

  it("prunes stale unsynced usage rows without deleting Stripe-linked usage", async () => {
    const user = await createUser();
    const usageIds: string[] = [];
    for (const suffix of ["pending", "failed", "synced"]) {
      const usage = await prisma.usageRecord.create({
        data: {
          eventKey: `analysis:retention-${suffix}`,
          userId: user.id,
          kind: "ANALYSIS",
          quantity: 1,
          unit: "job",
          unitCostMicros: 1_000,
          totalCostMicros: 1_000,
          createdAt: new Date(Date.now() - 31 * DAY),
        },
      });
      usageIds.push(usage.id);
    }

    await prisma.stripeUsageItem.createMany({
      data: [
        {
          usageRecordId: usageIds[0],
          status: "PENDING",
          createdAt: new Date(Date.now() - 31 * DAY),
        },
        {
          usageRecordId: usageIds[1],
          status: "FAILED",
          createdAt: new Date(Date.now() - 31 * DAY),
        },
        {
          usageRecordId: usageIds[2],
          status: "SYNCED",
          stripeInvoiceItemId: "ii_retained",
          createdAt: new Date(Date.now() - 31 * DAY),
        },
      ],
    });

    await retentionSweep();
    expect(await prisma.stripeUsageItem.count()).toBe(1);
    expect(
      await prisma.stripeUsageItem.findUnique({
        where: { usageRecordId: usageIds[2] },
      }),
    ).toMatchObject({ status: "SYNCED", stripeInvoiceItemId: "ii_retained" });
  });
});
