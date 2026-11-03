"use client";

import { Button } from "@/components/ui/button";

export interface DownloadButtonsProps {
  jobId: string;
  /** Full document (context-output B3). */
  markdown: string;
  /** Full structured result (context-output B4). */
  json: unknown;
  className?: string;
}

/** Trigger a client-side blob download; revokes the object URL afterwards. */
function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Keep filenames safe: `opencontext-<jobid>.<ext>` with a sanitized id. */
function safeJobId(jobId: string): string {
  const safe = jobId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return safe || "job";
}

/**
 * Download Markdown (`opencontext-<jobid>.md`) and Download JSON
 * (`opencontext-<jobid>.json`) — context-output B3/B4.
 */
export function DownloadButtons({
  jobId,
  markdown,
  json,
  className,
}: DownloadButtonsProps) {
  const id = safeJobId(jobId);
  return (
    <div className={className}>
      <Button
        variant="secondary"
        onClick={() =>
          downloadFile(`opencontext-${id}.md`, markdown, "text/markdown;charset=utf-8")
        }
      >
        Download Markdown
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          downloadFile(
            `opencontext-${id}.json`,
            JSON.stringify(json, null, 2),
            "application/json;charset=utf-8",
          )
        }
      >
        Download JSON
      </Button>
    </div>
  );
}
