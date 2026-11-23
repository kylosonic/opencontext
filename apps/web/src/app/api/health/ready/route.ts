import { NextResponse } from "next/server";
import { ReadinessResponseSchema } from "@kylosonic/opencontext-schemas";
import { deploymentEnvironment, evaluateReadiness } from "@/server/readiness";
import { verifyOpsToken } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const environment = deploymentEnvironment(process.env);
  const report = evaluateReadiness(process.env, environment);
  const detailed = verifyOpsToken(request);
  const payload = ReadinessResponseSchema.parse({
    ...report,
    checks: detailed
      ? report.checks
      : report.checks.map((check) => ({
          id: check.id,
          ok: check.ok,
          detail: check.ok ? "Ready" : "Unavailable",
        })),
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
