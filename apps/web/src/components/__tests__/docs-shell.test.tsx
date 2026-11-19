// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocsSidebar } from "../docs-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/api",
}));

afterEach(cleanup);

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  }
});

describe("docs navigation", () => {
  it("marks the current docs page and opens navigation on demand", () => {
    render(<DocsSidebar />);

    expect(
      screen
        .getByRole("link", { name: "Jobs API" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getAllByRole("link", { name: "Quickstart" }).length,
    ).toBeGreaterThan(0);
    for (const name of [
      "Uploading media",
      "Job lifecycle",
      "Results & evidence",
      "Security & retention",
    ]) {
      expect(screen.getAllByRole("link", { name }).length).toBeGreaterThan(0);
    }

    const toggle = screen.getByRole("button", {
      name: "Open documentation navigation",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe(
      "Close documentation navigation",
    );
  });
});
