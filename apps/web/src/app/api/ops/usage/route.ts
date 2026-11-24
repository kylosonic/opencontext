import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { verifyOpsToken, errorResponse, withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
  requestRateKey,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const limit = await consumeRateLimit(
      requestRateKey(request, "ops-usage"),
      RATE_LIMITS.operations.limit,
      RATE_LIMITS.operations.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Usage reporting is temporarily unavailable"
            : "Usage reporting limit reached — try again shortly",
        ),
        limit,
      );
    }
    if (!verifyOpsToken(request)) {
      return applyRateLimitHeaders(
        errorResponse("WORKER_UNAUTHORIZED", "Invalid operations token"),
        limit,
      );
    }
    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      return applyRateLimitHeaders(
        errorResponse("VALIDATION_ERROR", "since must be an ISO timestamp"),
        limit,
      );
    }
    const where: Prisma.UsageRecordWhereInput = since
      ? { createdAt: { gte: since } }
      : {};
    const [totals, byWorkspace, records] = await Promise.all([
      prisma.usageRecord.aggregate({
        where,
        _sum: { totalCostMicros: true, quantity: true },
        _count: true,
      }),
      prisma.usageRecord.groupBy({
        by: ["workspaceId"],
        where,
        _sum: { totalCostMicros: true, quantity: true },
        _count: true,
      }),
      prisma.usageRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          eventKey: true,
          userId: true,
          workspaceId: true,
          jobId: true,
          kind: true,
          quantity: true,
          unit: true,
          unitCostMicros: true,
          totalCostMicros: true,
          provider: true,
          model: true,
          createdAt: true,
        },
      }),
    ]);
    return applyRateLimitHeaders(NextResponse.json({
      totals: {
        records: totals._count,
        quantity: totals._sum.quantity ?? 0,
        costMicros: totals._sum.totalCostMicros ?? 0,
      },
      byWorkspace,
      records,
    }), limit);
  });
}
