// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SourceGallery } from "@/components/app/source-gallery";
import { OcrPanel } from "@/components/results/panels/ocr-panel";
import { TranscriptPanel } from "@/components/results/panels/transcript-panel";

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

    expect(
      screen.getByRole("img", { name: /Source image 1/ }).getAttribute("src"),
    ).toBe("/api/jobs/job-1/source?asset=0");
    await user.click(screen.getByRole("button", { name: "Image 2" }));
    expect(
      screen.getByRole("img", { name: /Source image 2/ }).getAttribute("src"),
    ).toBe("/api/jobs/job-1/source?asset=1");
  });

  it("renders a PDF preview in its own accessible frame", () => {
    render(
      <SourceGallery
        sourceUrl="/api/jobs/job-2/source"
        sourceKind="pdf"
        displayName="spec.pdf"
      />,
    );
    const frame = screen.getByTitle("Source PDF: spec.pdf");
    expect(frame.getAttribute("src")).toBe(
      "/api/jobs/job-2/source?asset=0#page=1",
    );
    expect(frame.hasAttribute("sandbox")).toBe(false);
  });

  it("uses image and PDF specific transcript empty states", () => {
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
  });

  it("uses source-specific OCR empty states", () => {
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
