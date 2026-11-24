// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceManager } from "@/components/app/workspace-manager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("workspace manager", () => {
  it("shows create-team errors inside the create card even when the user has zero teams", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Team name already taken" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    render(<WorkspaceManager initial={[]} />);

    await user.type(screen.getByLabelText("Team name"), "Product research");
    await user.click(screen.getByRole("button", { name: "Create team" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Team name already taken");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("loads members automatically on mount and uses singular counts and aria-pressed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              userId: "u-1",
              name: "Ada",
              email: "ada@example.com",
              githubLogin: "ada",
              role: "OWNER",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    render(
      <WorkspaceManager
        initial={[
          {
            id: "ws-1",
            name: "Design Ops",
            role: "OWNER",
            memberCount: 1,
            jobCount: 1,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ada")).toBeTruthy();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/members",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
    expect(screen.getByText("1 member · 1 job")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Design Ops/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
