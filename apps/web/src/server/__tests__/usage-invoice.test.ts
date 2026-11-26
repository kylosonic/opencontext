import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageInvoiceSchema } from "@kylosonic/opencontext-schemas";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { GET as invoiceGet } from "@/app/api/usage/invoice/route";
import {
  invoiceMonthBounds,
  usageInvoiceForUser,
  usageInvoiceToCsv,
} from "@/server/billing/invoice";
import { prisma } from "@/server/db/prisma";
import { initialStageStates } from "@/server/jobs";
import { resetRateLimits } from "@/server/security/rate-limit";
import { createWorkspace } from "@/server/workspaces";
import { createUser, resetDatabase } from "./helpers";

const NOVEMBER_2026 = new Date("2026-12-01T12:00:00.000Z");

function asUser(userId: string | null): void {
  authMock.auth.mockResolvedValue(
    userId ? { user: { id: userId, name: "Usage Tester" } } : null,
  );
}

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  authMock.auth.mockReset();
});

describe("monthly usage invoice export", () => {
  it("validates month bounds without UTC rollover", () => {
    expect(invoiceMonthBounds("2026-11", NOVEMBER_2026)).toEqual({
      month: "2026-11",
      start: new Date("2026-11-01T00:00:00.000Z"),
      endExclusive: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(invoiceMonthBounds("2026-13", NOVEMBER_2026)).toBeNull();
    expect(invoiceMonthBounds("", NOVEMBER_2026)).toBeNull();
    expect(invoiceMonthBounds("1999-12", NOVEMBER_2026)).toBeNull();
    expect(invoiceMonthBounds("not-a-month", NOVEMBER_2026)).toBeNull();
  });

  it("builds deterministic personal and team drafts without mixing scopes", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const workspace = await createWorkspace(owner.id, "Invoice Team");
    if (workspace.kind !== "OK") throw new Error("expected workspace");

    const personalJob = await prisma.job.create({
      data: {
        userId: owner.id,
        displayName: "=2+2,\"walkthrough\"",
        status: "COMPLETED",
        sourceExt: "mp4",
        durationSec: 12,
        stageStates: initialStageStates(),
        completedAt: new Date("2026-11-12T10:00:00.000Z"),
      },
    });
    const teamJob = await prisma.job.create({
      data: {
        userId: owner.id,
        workspaceId: workspace.workspace.id,
        displayName: "team.png",
        status: "COMPLETED",
        sourceExt: "png",
        stageStates: initialStageStates(),
        completedAt: new Date("2026-11-13T10:00:00.000Z"),
      },
    });

    await prisma.usageRecord.createMany({
      data: [
        {
          eventKey: "personal-nov",
          userId: owner.id,
          jobId: personalJob.id,
          kind: "ANALYSIS",
          quantity: 12,
          unit: "media-second",
          unitCostMicros: 10,
          totalCostMicros: 120,
          provider: "opencontext",
          model: "standard-analysis",
          metadata: { detailLevel: "HIGH", sourceExt: "mp4" },
          createdAt: new Date("2026-11-12T10:01:00.000Z"),
        },
        {
          eventKey: "team-nov",
          userId: owner.id,
          workspaceId: workspace.workspace.id,
          jobId: teamJob.id,
          kind: "ANALYSIS",
          quantity: 1,
          unit: "job",
          unitCostMicros: 7_500,
          totalCostMicros: 7_500,
          provider: "opencontext",
          model: "standard-analysis",
          metadata: { detailLevel: "MEDIUM", sourceExt: "png" },
          createdAt: new Date("2026-11-13T10:01:00.000Z"),
        },
        {
          eventKey: "personal-oct",
          userId: owner.id,
          jobId: personalJob.id,
          kind: "ANALYSIS",
          quantity: 12,
          unit: "media-second",
          unitCostMicros: 10,
          totalCostMicros: 120,
          metadata: { detailLevel: "HIGH", sourceExt: "mp4" },
          createdAt: new Date("2026-10-31T23:59:59.000Z"),
        },
      ],
    });

    const personal = await usageInvoiceForUser(owner.id, {
      month: "2026-11",
      now: NOVEMBER_2026,
    });
    expect(personal.kind).toBe("OK");
    if (personal.kind !== "OK") throw new Error("expected personal invoice");
    expect(UsageInvoiceSchema.parse(personal.invoice)).toEqual(personal.invoice);
    expect(personal.invoice.scope).toEqual({
      type: "personal",
      workspaceId: null,
      workspaceName: null,
    });
    expect(personal.invoice.lineItems).toHaveLength(1);
    expect(personal.invoice.totals).toMatchObject({
      lineItems: 1,
      mediaSeconds: 12,
      stillJobs: 0,
      costMicros: 120,
    });

    const repeat = await usageInvoiceForUser(owner.id, {
      month: "2026-11",
      now: NOVEMBER_2026,
    });
    expect(repeat.kind).toBe("OK");
    if (repeat.kind === "OK") {
      expect(repeat.invoice.invoiceNumber).toBe(personal.invoice.invoiceNumber);
    }

    const team = await usageInvoiceForUser(owner.id, {
      month: "2026-11",
      workspaceId: workspace.workspace.id,
      now: NOVEMBER_2026,
    });
    expect(team.kind).toBe("OK");
    if (team.kind !== "OK") throw new Error("expected team invoice");
    expect(team.invoice.scope).toMatchObject({
      type: "team",
      workspaceId: workspace.workspace.id,
      workspaceName: "Invoice Team",
    });
    expect(team.invoice.lineItems).toHaveLength(1);
    expect(team.invoice.totals.costMicros).toBe(7_500);
    expect(
      await usageInvoiceForUser(outsider.id, {
        month: "2026-11",
        workspaceId: workspace.workspace.id,
      }),
    ).toEqual({ kind: "FORBIDDEN" });

    const csv = usageInvoiceToCsv(personal.invoice);
    expect(csv).toContain("\"'=2+2,\"\"walkthrough\"\"\"");
    expect(csv).toContain(",TOTAL,");
    expect(csv).toContain(",120\r\n");
  });

  it("enforces auth, query validation, and downloadable response headers", async () => {
    const user = await createUser();
    asUser(null);
    expect(
      (await invoiceGet(new Request("http://localhost/api/usage/invoice"))).status,
    ).toBe(401);

    asUser(user.id);
    expect(
      (
        await invoiceGet(
          new Request("http://localhost/api/usage/invoice?month=2026-13"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await invoiceGet(
          new Request("http://localhost/api/usage/invoice?format=xml"),
        )
      ).status,
    ).toBe(400);

    const response = await invoiceGet(
      new Request("http://localhost/api/usage/invoice?format=csv"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="oc-\d{6}-[a-f0-9]{12}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toMatch(/invoice_number,status,currency/);
  });
});
