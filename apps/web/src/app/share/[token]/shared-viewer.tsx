"use client";

import { useCallback, useRef, useState } from "react";
import { SourceGallery } from "@/components/app/source-gallery";
import { ResultViewer } from "@/components/results/result-viewer";
import type {
  AnalysisResultView,
  JobHeaderView,
} from "@/components/results/types";

export interface SharedViewerProps {
  job: JobHeaderView;
  result: AnalysisResultView;
  sourceUrl: string;
  imageCount: number;
  pageCount: number;
}

/**
 * Interactive client shell for public read-only share snapshots so evidence
 * citations, timeline entries, and transcript timestamps can seek media or
 * switch image/PDF pages cleanly without exposing owner controls.
 */
export function SharedViewer({
  job,
  result,
  sourceUrl,
  imageCount,
  pageCount,
}: SharedViewerProps) {
  const [selectedAssetIndex, setSelectedAssetIndex] = useState(0);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null,
  );
  const [sourceBroken, setSourceBroken] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const sourceKind = job.sourceKind;

  const seekTo = useCallback(
    (timestampSec: number, sourceAssetIndex?: number) => {
      setSelectedTimestamp(timestampSec);
      if (sourceAssetIndex !== undefined) {
        setSelectedAssetIndex(sourceAssetIndex);
      }
      if (sourceKind !== "video" && sourceKind !== "audio") return;
      const media = sourceKind === "audio" ? audioRef.current : videoRef.current;
      if (!media) return;
      media.currentTime = timestampSec;
      void media.play().catch(() => undefined);
    },
    [sourceKind],
  );

  const sourceSlot =
    !sourceBroken && sourceKind ? (
      sourceKind === "image" ? (
        <SourceGallery
          sourceUrl={sourceUrl}
          sourceKind="image"
          displayName={job.displayName}
          assetCount={Math.max(1, imageCount)}
          selectedIndex={selectedAssetIndex}
          onSelectedIndexChange={setSelectedAssetIndex}
          onError={() => setSourceBroken(true)}
        />
      ) : sourceKind === "pdf" ? (
        <SourceGallery
          sourceUrl={sourceUrl}
          sourceKind="pdf"
          displayName={job.displayName}
          assetCount={Math.max(1, pageCount)}
          selectedIndex={selectedAssetIndex}
          onSelectedIndexChange={setSelectedAssetIndex}
          onError={() => setSourceBroken(true)}
        />
      ) : sourceKind === "audio" ? (
        <audio
          ref={audioRef}
          src={sourceUrl}
          controls
          preload="metadata"
          aria-label="Source audio"
          className="w-full bg-panel p-4"
          onError={() => setSourceBroken(true)}
        />
      ) : (
        <video
          ref={videoRef}
          src={sourceUrl}
          controls
          preload="metadata"
          aria-label="Source video"
          className="aspect-video w-full bg-black"
          onError={() => setSourceBroken(true)}
        />
      )
    ) : undefined;

  return (
    <ResultViewer
      job={job}
      result={result}
      stages={[]}
      readOnly
      onSeek={sourceKind ? seekTo : undefined}
      selectedTimestamp={selectedTimestamp}
      sourceSlot={sourceSlot}
    />
  );
}
