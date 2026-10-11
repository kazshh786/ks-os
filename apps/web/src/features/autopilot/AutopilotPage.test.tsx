import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AutopilotPage } from "./AutopilotPage";
import { AgencyAutopilotPage } from "./AgencyAutopilotPage";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  agency: vi.fn(),
  capabilities: ["fulfilment.read"] as string[],
}));
vi.mock("../../api/client", () => ({ fetchWithAuth: mocks.fetch }));
vi.mock("../agency/AgencyAuth", () => ({
  agencyFetch: mocks.agency,
  useAgencyAuth: () => ({ session: { capabilities: mocks.capabilities } }),
}));
const summary = () => ({
  attention: { issues: 1, approvals: 1 },
  controls: { outboundPaused: false, emergencyStopped: false },
  counts: { handled: 3, tasks: 2, queued: 1 },
  playbooks: [
    {
      id: "rule",
      name: "Quote waiting for a response",
      status: "ACTIVE",
      version: "1.0.0",
    },
  ],
  approvals: [
    {
      reference: "approval",
      title: "Review quote follow-up",
      reason: "Approve a task. No customer message will be sent.",
      requestedAt: "2026-10-11T10:00:00Z",
      expiresAt: "2026-10-14T10:00:00Z",
    },
  ],
  issues: [{ reference: "issue", category: "AUTOMATION", severity: "WARNING" }],
  activity: [
    {
      at: "2026-10-11T10:00:00Z",
      label: "Customer message queued",
      playbook: "Booking reminder",
    },
  ],
});
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.capabilities = ["fulfilment.read"];
  mocks.fetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ data: summary() }),
  }));
});
describe("Autopilot owner experience", () => {
  it("uses evidenced plain-language counts and distinguishes queued delivery", async () => {
    render(
      <MemoryRouter>
        <AutopilotPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Needs you" });
    expect(screen.getByText("Actions completed today")).toBeTruthy();
    expect(screen.getByText("Customer message queued")).toBeTruthy();
    expect(screen.queryByText("Customer message sent")).toBeNull();
    expect(screen.queryByText(/hours saved|AUTOMATION_ACTION_RUN/)).toBeNull();
    expect(
      screen
        .getByRole("switch", { name: "Quote waiting for a response" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
  it("keyboard decision sends only the decision, then reloads evidence", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AutopilotPage />
      </MemoryRouter>,
    );
    const approve = await screen.findByRole("button", {
      name: "Approve follow-up task",
    });
    approve.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/v1/autopilot/approvals/approval/decision",
        expect.objectContaining({ body: '{"decision":"APPROVED"}' }),
      ),
    );
    expect(approve.className).toContain("min-h-11");
    expect(approve.className).toContain("focus-visible");
  });
  it("exposes failed saves without claiming success", async () => {
    render(
      <MemoryRouter>
        <AutopilotPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Needs you" });
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "Decision expired" } }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Decision expired",
    );
  });
});
describe("Agency review queue", () => {
  it("shows reasons and ages without exposing emergency control to read-only staff", async () => {
    mocks.agency.mockResolvedValue({
      businesses: [
        {
          reference: "business",
          name: "Acme",
          state: "ACTION_REQUIRED",
          reason: "An approval has waited more than 24 hours",
          stopped: false,
          issues: 0,
          failures: 0,
          approvals: 1,
        },
      ],
      queue: [
        {
          reference: "q",
          business: "Acme",
          businessReference: "business",
          category: "AUTOMATION",
          severity: "WARNING",
          reason: "Owner decision waiting",
          at: "2026-10-10T10:00:00Z",
          next: "Ask the owner to review their approval",
        },
      ],
      nextOffset: null,
    });
    render(
      <MemoryRouter>
        <AgencyAutopilotPage />
      </MemoryRouter>,
    );
    await screen.findByText("Owner decision waiting", { exact: false });
    expect(
      screen.getByText("An approval has waited more than 24 hours"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Emergency stop" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
