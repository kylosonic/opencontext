import { cx } from "@/components/ui/cx";
import type { StageState } from "./types";

const STATUS_SYMBOL: Record<StageState["status"], string> = {
  done: "✓",
  running: "●",
  pending: "○",
  failed: "✕",
  skipped: "—",
};

const STATUS_LABEL: Record<StageState["status"], string> = {
  done: "Complete",
  running: "In progress",
  pending: "Not started",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_CLASS: Record<StageState["status"], string> = {
  done: "text-ok",
  running: "text-accent stage-running",
  pending: "text-ink-faint",
  failed: "text-err",
  skipped: "text-ink-faint",
};

export interface StageChecklistProps {
  stages: StageState[];
  /** 0–100 overall progress; rendered with a progressbar when present. */
  progress?: number;
  /** Seconds elapsed; rendered as a mono readout when present. */
  elapsedSec?: number;
  className?: string;
}

/**
 * The ✓/●/○ stage checklist (jobs.md B2). Purely presentational — the owner
 * passes live stage states; the demo passes scripted ones.
 */
export function StageChecklist({
  stages,
  progress,
  elapsedSec,
  className,
}: StageChecklistProps) {
  return (
    <div className={cx("space-y-3", className)}>
      <ul aria-label="Processing stages" className="space-y-1.5">
        {stages.map((stage) => (
          <li key={stage.name} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cx(
                "w-4 text-center font-mono text-sm leading-none",
                STATUS_CLASS[stage.status],
              )}
            >
              {STATUS_SYMBOL[stage.status]}
            </span>
            <span className="text-sm text-ink">{stage.name}</span>
            <span className="sr-only"> — {STATUS_LABEL[stage.status]}</span>
          </li>
        ))}
      </ul>
      {progress !== undefined && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall progress"
            className="h-1.5 grow overflow-hidden rounded-full bg-panel-muted"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <span className="font-mono text-xs text-ink-muted">{progress}%</span>
          {elapsedSec !== undefined && (
            <span className="font-mono text-xs text-ink-faint">
              {elapsedSec.toFixed(1)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
