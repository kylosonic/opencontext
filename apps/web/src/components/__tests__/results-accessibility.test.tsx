// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { EvidenceReviewPanel } from "@/components/results/panels/evidence-review-panel";
import { TimelinePanel } from "@/components/results/panels/timeline-panel";
import { VideoArea } from "@/components/results/video-area";

afterEach(cleanup);

function TabsHarness() {
  const [value, setValue] = useState("transcript");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabList label="Result sections">
        <Tab id="transcript">Transcript</Tab>
        <Tab id="visual">Visual Analysis</Tab>
        <Tab id="timeline">Timeline</Tab>
      </TabList>
      <TabPanel id="transcript">Transcript content</TabPanel>
      <TabPanel id="visual">Visual content</TabPanel>
      <TabPanel id="timeline">Timeline content</TabPanel>
    </Tabs>
  );
}

describe("results viewer accessibility", () => {
  it("moves focus and selection with arrow keys", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    const transcript = screen.getByRole("tab", { name: "Transcript" });
    const visual = screen.getByRole("tab", { name: "Visual Analysis" });
    expect(transcript.getAttribute("tabindex")).toBe("0");
    expect(visual.getAttribute("tabindex")).toBe("-1");

    transcript.focus();
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(visual);
    expect(visual.getAttribute("aria-selected")).toBe("true");
    expect(transcript.getAttribute("tabindex")).toBe("-1");
  });

  it("seeks from a focused timeline entry with the keyboard", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <TimelinePanel
        onSeek={onSeek}
        entries={[
          {
            start: 0,
            end: 3,
            title: "Opening scene",
            summary: "The editor opens a project.",
          },
        ]}
      />,
    );

    const button = screen.getByRole("button", {
      name: /Seek to .*Opening scene/,
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("labels evidence with ID, timestamp, and review status", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(
      <EvidenceReviewPanel
        jobId="job-1"
        demo
        onSeek={onSeek}
        onSaved={vi.fn()}
        evidence={[
          {
            id: 7,
            kind: "TRANSCRIPT",
            timestampSec: 4,
            certainty: "OBSERVED",
            text: "Click Save.",
            source: { collection: "transcript", index: 0 },
            review: {
              status: "FLAGGED",
              reviewedAt: "2026-11-08T00:00:00.000Z",
            },
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "All (1)" }));
    const article = screen.getByRole("article", {
      name: /Evidence 7, transcript, observed, timestamp 00:04, flagged/i,
    });
    expect(article).toBeTruthy();
    const seek = screen.getByRole("button", {
      name: /Jump to evidence 7 at 00:04, flagged/i,
    });
    seek.focus();
    await user.keyboard("{Enter}");
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it("exposes the video placeholder as a named region", () => {
    render(<VideoArea sourceName="recording.mp4" />);
    expect(screen.getByRole("region", { name: "Source video" })).toBeTruthy();
  });
});
