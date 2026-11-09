import { NextResponse } from "next/server";
import { deploymentEnvironment, evaluateReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const environment = deploymentEnvironment(process.env);
  const report = evaluateReadiness(process.env, environment);
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
