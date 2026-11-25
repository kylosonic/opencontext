// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { JobDetailClient } from "@/components/app/job-detail";
import { WorkspaceRolesPanel } from "@/components/app/workspace-roles-panel";
import { WorkspaceScimPanel } from "@/components/app/workspace-scim-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("phase 3 UI components", () => {
  it("creates and deletes custom workspace roles in WorkspaceRolesPanel", async () => {
    const user = userEvent.setup();
    const onRolesChange = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "role-1",
            name: "QA Reviewer",
            description: "Can review and re-run",
            permissions: ["jobs:create", "jobs:edit", "usage:view"],
            memberCount: 0,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { rerender } = render(
      <WorkspaceRolesPanel
        workspaceId="ws-1"
        roles={[]}
        canManage
        onRolesChange={onRolesChange}
      />,
    );

    await user.type(screen.getByLabelText("Custom role name"), "QA Reviewer");
    await user.click(screen.getByRole("button", { name: "Create custom role" }));

    await waitFor(() => {
      expect(onRolesChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "role-1", name: "QA Reviewer" }),
      ]);
    });

    rerender(
      <WorkspaceRolesPanel
        workspaceId="ws-1"
        roles={[
          {
            id: "role-1",
            name: "QA Reviewer",
            description: "Can review and re-run",
            permissions: ["jobs:create", "jobs:edit", "usage:view"],
            memberCount: 0,
          },
        ]}
        canManage
        onRolesChange={onRolesChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete role" }));
    await waitFor(() => {
      expect(onRolesChange).toHaveBeenCalledWith([]);
    });
  });

  it("loads, creates, reveals once, and revokes SCIM tokens in WorkspaceScimPanel", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/workspaces/ws-1/scim-tokens" && method === "GET") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/workspaces/ws-1/scim-tokens" && method === "POST") {
        return new Response(
          JSON.stringify({
            token: "oc_scim_secret_value_12345",
            tokenRecord: {
              id: "scim-1",
              name: "Okta Prod",
              prefix: "oc_scim_secr",
              lastUsedAt: null,
              createdAt: "2026-11-25T00:00:00.000Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/workspaces/ws-1/scim-tokens/scim-1" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    render(<WorkspaceScimPanel workspaceId="ws-1" />);

    await user.type(screen.getByLabelText("SCIM token name"), "Okta Prod");
    await user.click(screen.getByRole("button", { name: "Generate SCIM token" }));

    const secretInput = (await screen.findByLabelText(
      "Generated SCIM token",
    )) as HTMLInputElement;
    expect(secretInput.value).toBe("oc_scim_secret_value_12345");

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(screen.getByText("SCIM token revoked.")).toBeTruthy();
    });
  });

  it("renders Download original link on JobDetailClient when job.source exists", () => {
    render(
      <JobDetailClient
        detail={{
          id: "job-1",
          displayName: "checkout-demo.mp4",
          status: "COMPLETED",
          detailLevel: "MEDIUM",
          progress: 100,
          stageStates: [
            { stage: "EXTRACTING", status: "SUCCEEDED", attempt: 1 },
            { stage: "TRANSCRIBING", status: "SUCCEEDED", attempt: 1 },
            { stage: "ANALYZING", status: "SUCCEEDED", attempt: 1 },
            { stage: "AGGREGATING", status: "SUCCEEDED", attempt: 1 },
            { stage: "GENERATING_CONTEXT", status: "SUCCEEDED", attempt: 1 },
          ],
          error: null,
          errorStage: null,
          failureKind: "NONE",
          retryCount: 0,
          retryAllowed: false,
          canManage: false,
          workspaceId: null,
          workspaceName: null,
          source: {
            kind: "video",
            key: "jobs/job-1/source.mp4",
            ext: "mp4",
            sizeBytes: 1024,
            durationSec: 5,
            audioPresent: false,
            assets: [],
          },
          createdAt: "2026-11-25T00:00:00.000Z",
          updatedAt: "2026-11-25T00:01:00.000Z",
          completedAt: "2026-11-25T00:01:00.000Z",
          expiresAt: "2026-12-09T00:01:00.000Z",
          retentionNote: "Retained for 14 days.",
        }}
        resultView={{
          formatVersion: 2,
          markdown: "# Developer Context: checkout-demo.mp4\n",
          json: {
            formatVersion: 2,
            evidenceVersion: 1,
            evidence: [],
          },
          transcript: [],
          observations: [],
          ocr: [],
          timeline: [],
        }}
        sourceUrl={null}
        canManage={false}
      />,
    );

    const link = screen.getByRole("link", {
      name: "Download original",
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/jobs/job-1/source?download=1");
  });
});
