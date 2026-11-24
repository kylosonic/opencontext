// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceGallery } from "@/components/app/source-gallery";
import { OcrPanel } from "@/components/results/panels/ocr-panel";
import { TranscriptPanel } from "@/components/results/panels/transcript-panel";
import { VisualPanel } from "@/components/results/panels/visual-panel";

afterEach(cleanup);

describe("image and PDF result surfaces", () => {
  it("switches between uploaded images without leaving the job page", async () => {
    const user = userEvent.setup();
    render(
      <SourceGallery
        sourceUrl="/api/jobs/job-1/source"
        sourceKind="image"
        displayName="checkout-flow.png"
        assetCount={3}
      />,
    );

    const image1 = screen.getByRole("button", { name: "Image 1" });
    const image2 = screen.getByRole("button", { name: "Image 2" });
    expect(image1.getAttribute("aria-pressed")).toBe("true");
    expect(image2.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("img", { name: /Source image 1/ }).getAttribute("src"),
    ).toBe("/api/jobs/job-1/source?asset=0");

    await user.click(image2);
    expect(image1.getAttribute("aria-pressed")).toBe("false");
    expect(image2.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("img", { name: /Source image 2/ }).getAttribute("src"),
    ).toBe("/api/jobs/job-1/source?asset=1");
  });

  it("renders a PDF preview and switches multi-page PDFs cleanly", async () => {
    const user = userEvent.setup();
    render(
      <SourceGallery
        sourceUrl="/api/jobs/job-2/source"
        sourceKind="pdf"
        displayName="spec.pdf"
        assetCount={3}
      />,
    );
    expect(
      screen.getByTitle("Source PDF: spec.pdf").getAttribute("src"),
    ).toBe("/api/jobs/job-2/source?asset=0#page=1");
    expect(
      screen.getByTitle("Source PDF: spec.pdf").hasAttribute("sandbox"),
    ).toBe(false);

    const page1 = screen.getByRole("button", { name: "Page 1" });
    const page2 = screen.getByRole("button", { name: "Page 2" });
    const page3 = screen.getByRole("button", { name: "Page 3" });
    expect(page1.getAttribute("aria-pressed")).toBe("true");
    expect(page2.getAttribute("aria-pressed")).toBe("false");
    expect(page3.getAttribute("aria-pressed")).toBe("false");

    await user.click(page2);
    expect(page1.getAttribute("aria-pressed")).toBe("false");
    expect(page2.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByTitle("Source PDF: spec.pdf").getAttribute("src"),
    ).toBe("/api/jobs/job-2/source?asset=0#page=2");
  });

  it("uses image, PDF, and audio specific transcript states and seeks timestamps", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TranscriptPanel segments={[]} audioPresent={false} sourceKind="image" />,
    );
    expect(
      screen.getByText("Still image — transcription does not apply").textContent,
    ).toBeTruthy();
    rerender(
      <TranscriptPanel segments={[]} audioPresent={false} sourceKind="pdf" />,
    );
    expect(
      screen.getByText("PDF source — transcription does not apply").textContent,
    ).toBeTruthy();
    rerender(<TranscriptPanel segments={[]} sourceKind="audio" />);
    expect(
      screen.getByText("Audio source — no speech detected").textContent,
    ).toBeTruthy();

    const onSeek = vi.fn();
    rerender(
      <TranscriptPanel
        segments={[{ start: 12, end: 18, text: "Hello" }]}
        sourceKind="audio"
        onSeek={onSeek}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: /Jump to transcript segment at \[00:12–00:18\]/i,
      }),
    );
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("uses audio-specific visual empty state and source-specific OCR empty states", () => {
    render(<VisualPanel observations={[]} sourceKind="audio" />);
    expect(
      screen.getByText(
        "Visual analysis does not apply to an audio-only source",
      ).textContent,
    ).toBeTruthy();

    const { rerender } = render(<OcrPanel entries={[]} sourceKind="image" />);
    expect(
      screen.getByText("No visible text was detected in this image").textContent,
    ).toBeTruthy();
    rerender(<OcrPanel entries={[]} sourceKind="pdf" />);
    expect(
      screen.getByText(
        "No visible or embedded text was detected in this PDF",
      ).textContent,
    ).toBeTruthy();
  });
});
