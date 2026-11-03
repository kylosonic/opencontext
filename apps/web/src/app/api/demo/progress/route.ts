import { NextResponse } from "next/server";
import { computeDemoProgress } from "@/server/demo/progress";

/**
 * GET /api/demo/progress?elapsed=<seconds> — public, deterministic.
 *
 * A scripted stage checklist computed as a pure function of the `elapsed`
 * query parameter (not the server wall clock), so tests can assert exact
 * responses. See `src/server/demo/progress.ts` for the timing table:
 * stages complete at 1.5 / 3.5 / 5.5 / 7.5s; the job completes at 8.0s.
 *
 * Invalid (non-numeric) or negative values are treated as 0 — the function
 * is total over all inputs.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("elapsed");
  const elapsed = raw === null ? 0 : Number(raw);

  return NextResponse.json(computeDemoProgress(elapsed), {
    headers: {
      // The elapsed clock is client-driven; responses are cheap and vary per
      // request, so never let a shared cache serve a stale frame.
      "Cache-Control": "no-store",
    },
  });
}
