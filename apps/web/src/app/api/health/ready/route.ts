import { NextResponse } from "next/server";
import { evaluateReadiness, isProductionEnv } from "@/server/readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const production = isProductionEnv(process.env);
  const report = evaluateReadiness(process.env, production);
  return NextResponse.json(
    {
      ...report,
      checkedAt: new Date().toISOString(),
    },
    {
      status: report.ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
