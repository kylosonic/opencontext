import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { getJob } from "@/server/jobs";
import { buildResultView } from "@/server/jobs/jobViews";
import { loadJobResultsData } from "@/server/jobs/loadJobResults";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Owner-only Markdown or JSON export for a terminal analysis. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }

    const format = new URL(request.url).searchParams.get("format") ?? "markdown";
    if (format !== "markdown" && format !== "json") {
      return errorResponse(
        "VALIDATION_ERROR",
        "Export format must be markdown or json",
      );
    }

    const { id } = await context.params;
    const result = await getJob(id, session.user.id);
    if (result.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (result.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }
    if (result.job.status !== "COMPLETED" && result.job.status !== "PARTIAL") {
      return errorResponse("NOT_FOUND", "This job has no generated context to export");
    }

    const data = await loadJobResultsData(id);
    const view = buildResultView(result.job, data);
    const filename = safeFilename(result.job.displayName);
    if (format === "markdown") {
      if (!view.markdown) {
        return errorResponse("NOT_FOUND", "This job has no Markdown export");
      }
      return new Response(view.markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="opencontext-${filename}.md"`,
        },
      });
    }

    return new Response(JSON.stringify(view.json, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="opencontext-${filename}.json"`,
      },
    });
  });
}

function safeFilename(displayName: string): string {
  const stem = displayName.replace(/\.[^.]+$/, "");
  return stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "context";
}
