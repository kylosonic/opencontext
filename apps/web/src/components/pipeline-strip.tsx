import type { ReactNode } from "react";

export interface PipelineStep {
  label: string;
  detail: string;
}

/**
 * The five-step pipeline, rendered as a vertical strip of numbered steps
 * (horizontal on wide screens). Used on the landing page and in the docs.
 * The connector hint animates subtly and respects prefers-reduced-motion.
 */
export function PipelineStrip({
  steps,
  caption,
}: {
  steps: PipelineStep[];
  caption?: ReactNode;
}) {
  return (
    <figure>
      <ol
        className="grid gap-0 md:grid-cols-5 md:gap-3"
        aria-label="OpenContext processing pipeline"
      >
        {steps.map((step, index) => (
          <li key={step.label} className="relative flex gap-4 md:flex-col md:gap-3">
            {/* Connector between steps */}
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[13px] top-8 h-[calc(100%-1.5rem)] w-px bg-line-strong md:hidden"
              />
            )}
            <div className="flex flex-col items-center md:flex-row md:gap-3">
              <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-panel font-mono text-xs text-ink-muted">
                {index + 1}
              </span>
              <span
                aria-hidden="true"
                className="hidden grow items-center md:flex"
              >
                <span className="pipeline-flow h-px w-full bg-line-strong">
                  <span className="sr-only">→</span>
                </span>
              </span>
            </div>
            <div className="pb-6 md:pb-0">
              <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                {step.label}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {caption && (
        <figcaption className="mt-4 text-sm leading-relaxed text-ink-faint">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
