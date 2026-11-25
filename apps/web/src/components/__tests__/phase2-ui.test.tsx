// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsList } from "@/components/app/jobs-list";
import { UsageDashboard } from "@/components/app/usage-dashboard";
import { WorkspaceManager } from "@/components/app/workspace-manager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("phase 2 UI components", () => {
  it("filters JobsList by status/format and shows empty filter feedback", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    render(
      <JobsList
        workspaces={[{ id: "ws-1", name: "Design Team" }]}
        initialJobs={[
          {
            id: "j-1",
            displayName: "walkthrough.mp4",
            status: "COMPLETED",
            detailLevel: "MEDIUM",
            progress: 100,
            currentStage: null,
            error: null,
            canManage: true,
            workspaceId: "ws-1",
            workspaceName: "Design Team",
            sourceKind: "video",
            createdAt: "2026-11-24T10:00:00.000Z",
            completedAt: "2026-11-24T10:01:00.000Z",
            expiresAt: "2026-12-08T10:01:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Design Team")).toBeTruthy();
    expect(screen.getByText("VIDEO")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Format filter"), "audio");
    await waitFor(() => {
      expect(screen.getByText("No matching jobs")).toBeTruthy();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/jobs?sourceKind=audio",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("switches UsageDashboard scope and window via /api/usage", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            days: 7,
            since: "2026-11-18T00:00:00.000Z",
            workspaceId: "ws-1",
            totalRecords: 3,
            totalCostMicros: 2500000,
            totalMediaSeconds: 45,
            totalStillJobs: 1,
            byDetailLevel: { LOW: 1, MEDIUM: 1, HIGH: 1 },
            bySourceKind: { video: 2, audio: 0, image: 1, pdf: 0, unknown: 0 },
            recent: [],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    render(
      <UsageDashboard
        workspaces={[{ id: "ws-1", name: "Core Ops", role: "OWNER" }]}
        initialSummary={{
          days: 30,
          since: "2026-10-26T00:00:00.000Z",
          workspaceId: null,
          totalRecords: 1,
          totalCostMicros: 0,
          totalMediaSeconds: 10,
          totalStillJobs: 0,
          byDetailLevel: { LOW: 0, MEDIUM: 1, HIGH: 0 },
          bySourceKind: { video: 1, audio: 0, image: 0, pdf: 0, unknown: 0 },
          recent: [],
        }}
      />,
    );

    expect(screen.getByText("$0.00")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Usage scope"), "ws-1");

    await waitFor(() => {
      expect(screen.getByText("$2.50")).toBeTruthy();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/usage?workspaceId=ws-1&days=30",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("creates and revokes invitations and updates member roles in WorkspaceManager", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/workspaces/ws-1/members" && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              userId: "u-owner",
              name: "Owner",
              email: "owner@example.com",
              githubLogin: "owner",
              role: "OWNER",
            },
            {
              userId: "u-member",
              name: "Sam",
              email: "sam@example.com",
              githubLogin: "sam",
              role: "MEMBER",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/workspaces/ws-1/invites" && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/workspaces/ws-1/invites" && method === "POST") {
        return new Response(
          JSON.stringify({
            invite: {
              id: "inv-1",
              email: "new@example.com",
              role: "VIEWER",
              expiresAt: "2026-12-02T00:00:00.000Z",
              createdAt: "2026-11-25T00:00:00.000Z",
            },
            url: "/app/teams/invite/tok123",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/workspaces/ws-1/invites/inv-1" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (
        url === "/api/workspaces/ws-1/members/u-member" &&
        method === "PATCH"
      ) {
        return new Response(
          JSON.stringify({ userId: "u-member", role: "VIEWER" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    render(
      <WorkspaceManager
        currentUserId="u-owner"
        initial={[
          {
            id: "ws-1",
            name: "Design Ops",
            role: "OWNER",
            memberCount: 2,
            jobCount: 0,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Sam")).toBeTruthy();
    });

    await user.selectOptions(screen.getByLabelText("Role for Sam"), "VIEWER");
    await waitFor(() => {
      expect(screen.getByText("Member role updated.")).toBeTruthy();
    });

    await user.type(screen.getByLabelText("Invite email"), "new@example.com");
    await user.selectOptions(screen.getByLabelText("Invite role"), "VIEWER");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    const linkInput = (await screen.findByLabelText(
      "Invitation link",
    )) as HTMLInputElement;
    expect(linkInput.value).toContain("/app/teams/invite/tok123");

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(screen.getByText("Invitation revoked.")).toBeTruthy();
    });
  });
});
