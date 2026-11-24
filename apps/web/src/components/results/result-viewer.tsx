"use client";

import { useState } from "react";
import { EvidenceRecordSchema } from "@kylosonic/opencontext-schemas";
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
  readOnly = false,
  reviewReadOnly = false,
  onSeek,
  sourceSlot,
  selectedTimestamp = null,
}: ResultViewerProps) {
  // results.md B1: Agent Context is the default-selected tab.
  const [tab, setTab] = useState("context");
  const [savedOverride, setSavedOverride] = useState<{
    jobId: string;
    markdown: string;
    json: unknown;
  } | null>(null);
  const activeOverride =
    savedOverride && savedOverride.jobId === job.id ? savedOverride : null;
  const effectiveMarkdown = activeOverride
    ? activeOverride.markdown
    : result.markdown;
  const effectiveJson = activeOverride ? activeOverride.json : result.json;
  const evidence = evidenceRecordsFromJson(effectiveJson);

  const visualFailed =
    job.sourceKind !== "audio" &&
    (job.status === "FAILED" ||
      (job.status === "PARTIAL" && result.observations.length === 0));

  const seekToSource = (timestampSec: number, sourceAssetIndex?: number) => {
    onSeek?.(timestampSec, sourceAssetIndex);
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
        sourceKind={job.sourceKind}
        demo={demo}
        selectedTimestamp={selectedTimestamp}
        sourceSlot={sourceSlot}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono mr-1">Agent Context</span>
        <CopyButton value={effectiveMarkdown} />
        {!readOnly && (
          <DownloadButtons
            jobId={job.id}
            markdown={effectiveMarkdown}
            json={effectiveJson}
          />
        )}
        {demo && (
          <Badge tone="accent" mono className="ml-auto">
            Demo Analysis
          </Badge>
        )}
      </div>

      <Card padded={false}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabList label="Result sections" className="px-5 pt-3">
            <Tab id="transcript">Transcript</Tab>
            <Tab id="visual">Visual Analysis</Tab>
            <Tab id="timeline">Timeline</Tab>
            <Tab id="ocr">OCR</Tab>
            <Tab id="context">Agent Context</Tab>
            {!readOnly && <Tab id="evidence">Evidence Review</Tab>}
          </TabList>

          <div className="px-5 pb-5">
            <TabPanel id="transcript">
              <TranscriptPanel
                segments={result.transcript}
                audioPresent={job.audioPresent}
                sourceKind={job.sourceKind}
                active={active}
                onSeek={onSeek ? seekToSource : undefined}
              />
            </TabPanel>
            <TabPanel id="visual">
              <VisualPanel
                observations={result.observations}
                active={active}
                failed={visualFailed}
                sourceKind={job.sourceKind}
              />
            </TabPanel>
            <TabPanel id="timeline">
              <TimelinePanel
                entries={result.timeline}
                onSeek={onSeek ? seekToSource : undefined}
                active={active}
                sourceKind={job.sourceKind}
              />
            </TabPanel>
            <TabPanel id="ocr">
              <OcrPanel entries={result.ocr} sourceKind={job.sourceKind} />
            </TabPanel>
            <TabPanel id="context">
              <ContextPanel
                markdown={effectiveMarkdown}
                demo={demo}
                evidence={evidence}
                sourceKind={job.sourceKind}
                allowDownloads={!readOnly}
                onSeek={onSeek ? seekToSource : undefined}
              />
            </TabPanel>
            {!readOnly && (
              <TabPanel id="evidence">
                <EvidenceReviewPanel
                  jobId={job.id}
                  evidence={evidence}
                  demo={demo}
                  readOnly={reviewReadOnly}
                  sourceKind={job.sourceKind}
                  onSeek={onSeek ? seekToSource : undefined}
                  onSaved={(updated) =>
                    setSavedOverride({
                      jobId: job.id,
                      markdown: updated.markdown,
                      json: updated.json,
                    })
                  }
                />
              </TabPanel>
            )}
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
