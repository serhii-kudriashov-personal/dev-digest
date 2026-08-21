/* EvalDashboardView (L06, SPEC-04) — AC-40…AC-44, AC-46, AC-47.
   AppShell pulls in the whole shell context (repo list, theme, palette); it
   is mocked at the boundary here, same principle as every hook mock below —
   this file tests the dashboard's OWN rendering, not the shell chrome. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
// Six `../`: src/app/evals/_components/EvalDashboardView.
import messages from "../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const mutateRunAll = vi.fn();
let dashboardData: unknown = undefined;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: dashboardData, isLoading: false, isError: false }),
  useRunAllEvals: () => ({ mutate: mutateRunAll, isPending: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  dashboardData = undefined;
  push.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("AC-44: a zero-case workspace shows guidance naming the finding-to-case action", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 0,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      agents: [],
      alert: null,
    };
    renderView();
    expect(
      screen.getByText(
        "Open a finding on a reviewed pull request and choose “Add to eval cases” to create the first one.",
      ),
    ).toBeInTheDocument();
  });

  it("AC-41: a never-run agent has a marker and no metric values", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 3,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      agents: [
        {
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          cases_total: 3,
          never_run: true,
          last_run: null,
          direction: null,
          comparable: false,
        },
      ],
      alert: null,
    };
    renderView();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("clicking an agent row opens that agent's Evals tab", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 3,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      agents: [
        {
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          cases_total: 3,
          never_run: true,
          last_run: null,
          direction: null,
          comparable: false,
        },
      ],
      alert: null,
    };
    renderView();
    fireEvent.click(screen.getByText("Security Reviewer"));
    expect(push).toHaveBeenCalledWith("/agents/ag1?tab=evals");
  });

  it("AC-40, AC-42, AC-46: recent runs from more than one agent, newest first, each naming agent + version + direction", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 5,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [
        {
          id: "run1",
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          config_version: 2,
          provider: "openrouter",
          model: "m",
          covered_case_ids: ["c1"],
          ran_at: "2026-08-02T00:00:00.000Z",
          finished_at: "2026-08-02T00:01:00.000Z",
          status: "complete",
          incomplete_reason: null,
          recall: 0.8,
          precision: 1,
          citation_accuracy: 1,
          cases_passed: 4,
          cases_covered: 5,
          cases_done: 5,
          cost_usd: 0.02,
          duration_ms: 1000,
          detail_expired: false,
        },
        {
          id: "run2",
          agent_id: "ag2",
          agent_name: "Performance Reviewer",
          config_version: 1,
          provider: "openrouter",
          model: "m",
          covered_case_ids: ["c2"],
          ran_at: "2026-08-01T00:00:00.000Z",
          finished_at: "2026-08-01T00:01:00.000Z",
          status: "complete",
          incomplete_reason: null,
          recall: 0.5,
          precision: 1,
          citation_accuracy: 1,
          cases_passed: 2,
          cases_covered: 4,
          cases_done: 4,
          cost_usd: null,
          duration_ms: 1000,
          detail_expired: false,
        },
      ],
      agents: [
        {
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          cases_total: 5,
          never_run: false,
          last_run: {
            id: "run1",
            agent_id: "ag1",
            agent_name: "Security Reviewer",
            config_version: 2,
            provider: "openrouter",
            model: "m",
            covered_case_ids: ["c1"],
            ran_at: "2026-08-02T00:00:00.000Z",
            finished_at: "2026-08-02T00:01:00.000Z",
            status: "complete",
            incomplete_reason: null,
            recall: 0.8,
            precision: 1,
            citation_accuracy: 1,
            cases_passed: 4,
            cases_covered: 5,
            cases_done: 5,
            cost_usd: 0.02,
            duration_ms: 1000,
            detail_expired: false,
          },
          direction: "up",
          comparable: true,
        },
      ],
      alert: null,
    };
    renderView();
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    // Direction carries TEXT, not only an icon (AC-46).
    expect(screen.getByText("improved")).toBeInTheDocument();
  });

  it("AC-23, AC-31: an unknown metric and unknown cost render the dash, never 0", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [
        {
          id: "run1",
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          config_version: 1,
          provider: "openrouter",
          model: "m",
          covered_case_ids: ["c1"],
          ran_at: "2026-08-01T00:00:00.000Z",
          finished_at: "2026-08-01T00:01:00.000Z",
          status: "complete",
          incomplete_reason: null,
          recall: null,
          precision: null,
          citation_accuracy: null,
          cases_passed: 0,
          cases_covered: 1,
          cases_done: 1,
          cost_usd: null,
          duration_ms: 1000,
          detail_expired: false,
        },
      ],
      agents: [],
      alert: null,
    };
    renderView();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("AC-43: the derived note renders when two runs differ", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      agents: [],
      alert: "Security Reviewer: recall improved by 0.30",
    };
    renderView();
    expect(screen.getByTestId("derived-note")).toHaveTextContent(
      "Security Reviewer: recall improved by 0.30",
    );
  });

  it("AC-43: no derived note renders when nothing differs", () => {
    dashboardData = {
      owner_kind: null,
      owner_id: null,
      cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      agents: [],
      alert: null,
    };
    renderView();
    expect(screen.queryByTestId("derived-note")).not.toBeInTheDocument();
  });
});
