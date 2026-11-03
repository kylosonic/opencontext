"use client";

import { useState } from "react";
import { EvidenceRecordSchema } from "@opencontext/schemas";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { CopyButton } from "./copy-button";
import { DownloadButtons } from "./download-buttons";
import { JobHeader } from "./job-header";
import { ContextPanel } from "./panels/context-panel";
import { EvidenceReviewPanel } from "./panels/evidence-review-panel";
import { OcrPanel } from "./panels/ocr-panel";
import { TimelinePanel } from "./panels/timeline-panel";
import { TranscriptPanel } from "./panels/transcript-panel";
import { VisualPanel } from "./panels/visual-panel";
import { StageChecklist } from "./stage-checklist";
import type { ResultViewerProps } from "./types";
import { VideoArea } from "./video-area";

/**
 * Results viewer shell — the reusable surface for demo and job output.
 * The view contract lives in ./types.ts.
 */
export function ResultViewer({
  job,
  result,
  stages,
  progress,
  elapsedSec,
  active = false,
  demo = false,
  onSeek,
  videoSlot,
  selectedTimestamp = null,
}: ResultViewerProps) {
  // results.md B1: Agent Context is the default-selected tab.
  const [tab, setTab] = useState("context");
  const [currentResult, setCurrentResult] = useState(result);
  const evidence = evidenceRecordsFromJson(currentResult.json);

  const visualFailed =
    job.status === "FAILED" ||
    (job.status === "PARTIAL" && result.observations.length === 0);

  const seekToSource = (timestampSec: number) => {
    onSeek?.(timestampSec);
    document
      .getElementById("source-video")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-6">
      <JobHeader job={job} demo={demo} />

      {stages && stages.length > 0 && (
        <Card>
          <StageChecklist
            stages={stages}
            progress={progress}
            elapsedSec={elapsedSec}
          />
        </Card>
      )}

      <VideoArea
        sourceName={job.displayName}
        demo={demo}
        selectedTimestamp={selectedTimestamp}
        videoSlot={videoSlot}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono mr-1">Agent Context</span>
        <CopyButton value={currentResult.markdown} />
        <DownloadButtons
          jobId={job.id}
          markdown={currentResult.markdown}
          json={currentResult.json}
        />
        {demo && (
          <Badge tone="accent" mono className="ml-auto">
            Demo Analysis
          </Badge>
        )}
      </div>

      <Card padded={false}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabList
            label="Result sections"
            className="px-5 pt-3"
            accessory={
              demo ? (
                <Badge tone="accent" mono>
                  Demo Analysis
                </Badge>
              ) : undefined
            }
          >
            <Tab id="transcript">Transcript</Tab>
            <Tab id="visual">Visual Analysis</Tab>
            <Tab id="timeline">Timeline</Tab>
            <Tab id="ocr">OCR</Tab>
            <Tab id="context">Agent Context</Tab>
            <Tab id="evidence">Evidence review</Tab>
          </TabList>

          <div className="px-5 pb-5">
            <TabPanel id="transcript">
              <TranscriptPanel segments={result.transcript} />
            </TabPanel>
            <TabPanel id="visual">
              <VisualPanel
                observations={result.observations}
                active={active}
                failed={visualFailed}
              />
            </TabPanel>
            <TabPanel id="timeline">
              <TimelinePanel
                entries={result.timeline}
                onSeek={onSeek ? seekToSource : undefined}
              />
            </TabPanel>
            <TabPanel id="ocr">
              <OcrPanel entries={result.ocr} />
            </TabPanel>
            <TabPanel id="context">
              <ContextPanel
                markdown={currentResult.markdown}
                demo={demo}
                onSeek={onSeek ? seekToSource : undefined}
              />
            </TabPanel>
            <TabPanel id="evidence">
              <EvidenceReviewPanel
                jobId={job.id}
                evidence={evidence}
                demo={demo}
                onSeek={onSeek ? seekToSource : undefined}
                onSaved={(updated) =>
                  setCurrentResult((current) => ({
                    ...current,
                    markdown: updated.markdown,
                    json: updated.json,
                  }))
                }
              />
            </TabPanel>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}

function evidenceRecordsFromJson(json: unknown) {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return [];
  }
  const evidence = (json as Record<string, unknown>).evidence;
  const parsed = EvidenceRecordSchema.array().safeParse(evidence);
  return parsed.success ? parsed.data : [];
}
