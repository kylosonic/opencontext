import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { formatDate } from "./format";
import type { JobHeaderView, JobStatusView } from "./types";

const STATUS_LABEL: Record<JobStatusView, string> = {
  QUEUED: "Queued",
  DOWNLOADING: "Downloading",
  EXTRACTING: "Extracting",
  TRANSCRIBING: "Transcribing",
  ANALYZING: "Analyzing",
  AGGREGATING: "Aggregating",
  GENERATING_CONTEXT: "Generating context",
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
};

function statusTone(status: JobStatusView): "success" | "warning" | "danger" | "accent" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "PARTIAL":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "accent";
  }
}

const ACTIVE_STATUSES: JobStatusView[] = [
  "QUEUED",
  "DOWNLOADING",
  "EXTRACTING",
  "TRANSCRIBING",
  "ANALYZING",
  "AGGREGATING",
  "GENERATING_CONTEXT",
];

export interface JobHeaderProps {
  job: JobHeaderView;
  demo?: boolean;
  className?: string;
}

/**
 * Job header card (results.md B3): display name, status, detail level,
 * created time, retention note, and — for demo jobs — the persistent
 * "Demo Analysis" badge.
 */
export function JobHeader({ job, demo = false, className }: JobHeaderProps) {
  const active = ACTIVE_STATUSES.includes(job.status);
  return (
    <Card className={cx("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink">
            {job.displayName}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            id: {job.id}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {demo && (
            <Badge tone="accent" mono>
              Demo Analysis
            </Badge>
          )}
          <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
          <Badge tone="neutral" mono>
            {job.detailLevel}
          </Badge>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-xs text-ink-muted">
        <div className="flex items-baseline gap-1.5">
          <dt className="label-mono">Created</dt>
          <dd className="text-ink">{formatDate(job.createdAt)}</dd>
        </div>
        {job.expiresAt && (
          <div className="flex items-baseline gap-1.5">
            <dt className="label-mono">Expires</dt>
            <dd className="text-ink">{formatDate(job.expiresAt)}</dd>
          </div>
        )}
        {active && (
          <div className="flex items-baseline gap-1.5">
            <dt className="label-mono">Status</dt>
            <dd className="text-ink">Processing — large videos can take a while</dd>
          </div>
        )}
      </dl>
      {job.retentionNote && (
        <p className="text-xs leading-relaxed text-ink-faint">
          {job.retentionNote}
        </p>
      )}
    </Card>
  );
}
