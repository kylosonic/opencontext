"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface SourceGalleryProps {
  sourceUrl: string;
  sourceKind: "image" | "pdf";
  displayName: string;
  assetCount?: number;
  onError?: () => void;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
}

/** Authenticated image-set gallery and PDF frame for job results. */
export function SourceGallery({
  sourceUrl,
  sourceKind,
  displayName,
  assetCount = 1,
  onError,
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
}: SourceGalleryProps) {
  const [internalIndex, setInternalIndex] = useState(0);
  const selectedIndex = Math.max(
    0,
    Math.min(assetCount - 1, controlledIndex ?? internalIndex),
  );
  const selectAsset = (index: number) => {
    if (controlledIndex === undefined) setInternalIndex(index);
    onSelectedIndexChange?.(index);
  };
  const selectedUrl = `${sourceUrl}?asset=${selectedIndex}`;

  if (sourceKind === "pdf") {
    return (
      <iframe
        src={selectedUrl}
        title={`Source PDF: ${displayName}`}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-[70vh] w-full bg-white"
      />
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="relative h-[70vh] w-full bg-code-bg">
        <Image
          src={selectedUrl}
          alt={`Source image ${selectedIndex + 1}: ${displayName}`}
          fill
          unoptimized
          sizes="100vw"
          className="object-contain"
          onError={onError}
        />
      </div>
      {assetCount > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Source images">
          {Array.from({ length: assetCount }, (_, index) => (
            <Button
              key={index}
              type="button"
              size="sm"
              variant={selectedIndex === index ? "primary" : "secondary"}
              onClick={() => selectAsset(index)}
            >
              Image {index + 1}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
