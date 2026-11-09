import { NextResponse } from "next/server";
import { ReadinessResponseSchema } from "@opencontext/schemas";
import { deploymentEnvironment, evaluateReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const environment = deploymentEnvironment(process.env);
  const report = evaluateReadiness(process.env, environment);
  const payload = ReadinessResponseSchema.parse({
    ...report,
    checkedAt: new Date().toISOString(),
  });
  return NextResponse.json(
    payload,
    {
      status: report.ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
