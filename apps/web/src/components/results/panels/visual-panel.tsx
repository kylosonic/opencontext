import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatClock } from "../format";
import type { Certainty, VisualObservationView } from "../types";
import { EmptyState } from "./empty-state";

const CERTAINTY_BADGE: Record<Certainty, { label: string; tone: "success" | "accent" | "warning" }> = {
  OBSERVED: { label: "Observed", tone: "success" },
  INFERRED: { label: "Inferred", tone: "accent" },
  UNCERTAIN: { label: "Uncertain", tone: "warning" },
};

export interface VisualPanelProps {
  observations: VisualObservationView[];
  /** Job still processing → "Analyzing…" instead of a bare empty tab. */
  active?: boolean;
  /** Job failed → specific failure message (results.md B4). */
  failed?: boolean;
}

/** Visual Analysis tab: certainty-tagged observation cards. */
export function VisualPanel({
  observations,
  active = false,
  failed = false,
}: VisualPanelProps) {
  if (observations.length === 0) {
    if (active) {
      return (
        <EmptyState
          title="Analyzing…"
          body="Visual frames are being analyzed. Observations appear here as they complete."
        />
      );
    }
    if (failed) {
      return (
        <EmptyState
          title="Visual analysis failed — no observations were produced"
          body="The vision stage did not complete for this job. Check the job status for the specific reason."
        />
      );
    }
    return (
      <EmptyState
        title="No visual observations were recorded"
        body="This job produced no frame observations."
      />
    );
  }

  return (
    <ol className="space-y-4">
      {observations.map((observation, index) => {
        const certainty = CERTAINTY_BADGE[observation.certainty];
        return (
          <li key={index}>
            <Card className="space-y-3" padded>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-faint">
                  {formatClock(observation.timestampSec)}
                </span>
                <Badge tone={certainty.tone} mono>
                  {certainty.label}
                </Badge>
                {observation.sceneTitle && (
                  <h3 className="text-sm font-semibold text-ink">
                    {observation.sceneTitle}
                  </h3>
                )}
              </div>

              {observation.visualDescription && (
                <p className="text-sm leading-relaxed text-ink">
                  {observation.visualDescription}
                </p>
              )}

              {observation.uiElements && observation.uiElements.length > 0 && (
                <div>
                  <h4 className="label-mono mb-2">UI elements</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {observation.uiElements.map((element) => (
                      <li
                        key={element}
                        className="rounded-md border border-line bg-panel-muted px-2 py-1 text-xs text-ink-muted"
                      >
                        {element}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {observation.visibleText && observation.visibleText.length > 0 && (
                <div>
                  <h4 className="label-mono mb-2">Visible text</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {observation.visibleText.map((text) => (
                      <li
                        key={text}
                        className="rounded-md border border-line bg-code-bg px-2 py-1 font-mono text-xs text-ink"
                      >
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {observation.interactions && observation.interactions.length > 0 && (
                <div>
                  <h4 className="label-mono mb-2">
                    Interactions <span className="normal-case">(inferred)</span>
                  </h4>
                  <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
                    {observation.interactions.map((interaction) => (
                      <li key={interaction}>{interaction}</li>
                    ))}
                  </ul>
                </div>
              )}

              {observation.layoutDescription && (
                <p className="text-sm leading-relaxed text-ink-muted">
                  <span className="label-mono mr-2">Layout</span>
                  {observation.layoutDescription}
                </p>
              )}

              {observation.designObservations &&
                Object.keys(observation.designObservations).length > 0 && (
                  <dl className="grid gap-x-6 gap-y-1.5 border-t border-line pt-3 sm:grid-cols-2">
                    {(
                      Object.entries(observation.designObservations) as [
                        string,
                        string,
                      ][]
                    ).map(([key, value]) => (
                      <div key={key} className="flex items-baseline gap-2">
                        <dt className="label-mono shrink-0">{key}</dt>
                        <dd className="text-sm text-ink-muted">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

              {observation.importantChanges &&
                observation.importantChanges.length > 0 && (
                  <div>
                    <h4 className="label-mono mb-2">Important changes</h4>
                    <ul className="list-inside list-disc space-y-1 text-sm text-ink">
                      {observation.importantChanges.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                )}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
