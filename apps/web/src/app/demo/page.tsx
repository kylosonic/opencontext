"use client";

import { useEffect, useState } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ResultViewer } from "@/components/results/result-viewer";
import { StageChecklist } from "@/components/results/stage-checklist";
import type {
  AnalysisResultView,
  JobHeaderView,
  StageState,
} from "@/components/results/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import type { DemoResult } from "@/server/demo/types";
import type { DemoProgress } from "@/server/demo/progress";

/** Local-clock tick for the scripted replay (ms). */
const TICK_MS = 250;

type Phase = "running" | "done" | "error";

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>("running");
  const [elapsed, setElapsed] = useState(0);
  const [stages, setStages] = useState<StageState[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seekedTo, setSeekedTo] = useState<number | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    let stopped = false;
    const startedAt = performance.now();

    const timer = window.setInterval(async () => {
      if (stopped) return;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      try {
        const res = await fetch(
          `/api/demo/progress?elapsed=${elapsedSec.toFixed(2)}`,
        );
        if (!res.ok) {
          throw new Error(`Progress request failed (HTTP ${res.status})`);
        }
        const data: DemoProgress = await res.json();
        setElapsed(elapsedSec);
        setStages(data.stages as StageState[]);
        setProgress(data.progress);

        if (data.completed) {
          stopped = true;
          window.clearInterval(timer);
          const resultRes = await fetch("/api/demo/result");
          if (!resultRes.ok) {
            throw new Error(`Result request failed (HTTP ${resultRes.status})`);
          }
          setResult((await resultRes.json()) as DemoResult);
          setPhase("done");
        }
      } catch (err) {
        stopped = true;
        window.clearInterval(timer);
        setError(err instanceof Error ? err.message : "Something went wrong");
        setPhase("error");
      }
    }, TICK_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase]);

  const replay = () => {
    setElapsed(0);
    setStages([]);
    setProgress(0);
    setResult(null);
    setSeekedTo(null);
    setError(null);
    setPhase("running");
  };

  const jobHeader: JobHeaderView | null = result
    ? {
        id: result.metadata.id,
        displayName: result.metadata.displayName,
        status: result.metadata.status,
        detailLevel: result.metadata.detailLevel,
        createdAt: result.metadata.createdAt,
        expiresAt: result.metadata.expiresAt,
        retentionNote: result.metadata.retentionNote,
      }
    : null;

  const resultView: AnalysisResultView | null = result
    ? {
        formatVersion: result.metadata.formatVersion,
        markdown: result.markdown,
        json: result,
        transcript: result.transcript,
        observations: result.observations,
        ocr: result.ocr,
        timeline: result.timeline,
      }
    : null;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-10">
          <header className="mb-8 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" mono>
                Demo Analysis
              </Badge>
              <Badge tone="neutral" mono>
                Pre-authored sample
              </Badge>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Demo analysis — banking app walkthrough
            </h1>
            <p className="mt-3 text-base leading-relaxed text-ink-muted">
              This demo replays a scripted stage checklist and then renders a
              pre-authored sample analysis. No video is uploaded or processed,
              and no AI credentials are involved. Every export carries the
              Demo Analysis marker.
            </p>
          </header>

          <div aria-live="polite">
            {phase === "running" && (
              <Card className="max-w-xl">
                <StageChecklist
                  stages={stages}
                  progress={progress}
                  elapsedSec={elapsed}
                />
                <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                  Scripted demo replay (~8 seconds). Stage states are computed
                  from a local clock via the public progress endpoint — nothing
                  is actually being processed.
                </p>
              </Card>
            )}

            {phase === "done" && result && jobHeader && resultView && (
              <>
                <ResultViewer
                  job={jobHeader}
                  result={resultView}
                  stages={(result.stages as StageState[]) ?? undefined}
                  demo
                  onSeek={setSeekedTo}
                  selectedTimestamp={seekedTo}
                />
                <div className="mt-6 flex items-center gap-3">
                  <Button onClick={replay} variant="ghost" size="sm">
                    Run demo again
                  </Button>
                  <span className="text-xs text-ink-faint">
                    The same deterministic result replays every time.
                  </span>
                </div>
              </>
            )}

            {phase === "error" && (
              <Card className="max-w-xl">
                <h2 className="text-base font-semibold text-err">
                  The demo could not load
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {error}
                </p>
                <Button onClick={replay} variant="secondary" size="sm" className="mt-4">
                  Try again
                </Button>
              </Card>
            )}
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
