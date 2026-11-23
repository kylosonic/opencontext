import { NextResponse } from "next/server";
import {
  PublicReadinessResponseSchema,
  ReadinessResponseSchema,
} from "@kylosonic/opencontext-schemas";
import { deploymentEnvironment, evaluateReadiness } from "@/server/readiness";
import { verifyOpsToken } from "@/server/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const environment = deploymentEnvironment(process.env);
  const report = evaluateReadiness(process.env, environment);
  const detailed = verifyOpsToken(request);
  const checkedAt = new Date().toISOString();
  const payload = detailed
    ? ReadinessResponseSchema.parse({ ...report, checkedAt })
    : PublicReadinessResponseSchema.parse({ ready: report.ready, checkedAt });
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
