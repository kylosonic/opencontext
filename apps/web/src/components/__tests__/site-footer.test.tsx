import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "../site-footer";

describe("SiteFooter", () => {
  it("describes the preview without claiming implemented features are pending", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText("OpenContext is a working preview with documented limits."),
    ).not.toBeNull();
    expect(screen.queryByText(/some features are still in development/i)).toBeNull();
  });
});
// @vitest-environment jsdom
