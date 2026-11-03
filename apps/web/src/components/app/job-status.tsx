import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { JobStatus } from "@opencontext/schemas";

/**
 * Status label/tone shared by the signed-in job surfaces. Copy mirrors
 * the results-shell JobHeader so the job list and job page always agree
 * on a state's wording (jobs.md B1 acceptance).
 */

const STATUS_LABEL: Record<JobStatus, string> = {
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

const STATUS_TONE: Record<JobStatus, BadgeTone> = {
  QUEUED: "accent",
  DOWNLOADING: "accent",
  EXTRACTING: "accent",
  TRANSCRIBING: "accent",
  ANALYZING: "accent",
  AGGREGATING: "accent",
  GENERATING_CONTEXT: "accent",
  COMPLETED: "success",
  PARTIAL: "warning",
  FAILED: "danger",
};

export function jobStatusLabel(status: JobStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function jobStatusTone(status: JobStatus): BadgeTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <Badge tone={jobStatusTone(status)} className={className}>
      {jobStatusLabel(status)}
    </Badge>
  );
}
