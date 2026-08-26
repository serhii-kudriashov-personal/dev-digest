/* EvalsTab (L06, SPEC-04) — never-run/unknown-metric rendering, the
   compare control's 0/1/3-selected states, and AC-48's focus return.
   Hooks are mocked at the boundary (`@/lib/hooks/eval`, `@/lib/hooks/agents`),
   never inside the component. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
// Eight `../`: src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab.
import messages from "../../../../../../../../messages/en/eval.json";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/agents/ag1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: { id: "ag1", name: "Reviewer", version: 3 } }),
}));

const mutateRunSet = vi.fn();
const mutateCancel = vi.fn();
const mutateRunCase = vi.fn();
const mutateDeleteCase = vi.fn();
const mutatePromote = vi.fn();

let evalCases: unknown[] = [];
let evalRuns: unknown[] = [];
let evalTrend: unknown[] = [];
let comparisonData: unknown = undefined;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: evalCases, isLoading: false }),
  useEvalRuns: () => ({ data: evalRuns }),
  useEvalRun: () => ({ data: undefined }),
  useEvalTrend: () => ({ data: evalTrend }),
  useRunEvalSet: () => ({ mutate: mutateRunSet, isPending: false }),
  useCancelEvalRun: () => ({ mutate: mutateCancel, isPending: false }),
  useRunEvalCase: () => ({ mutate: mutateRunCase, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: mutateDeleteCase }),
  usePromoteAgentVersion: () => ({ mutate: mutatePromote }),
  useEvalComparison: () => ({ data: comparisonData }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  evalCases = [];
  evalRuns = [];
  evalTrend = [];
  comparisonData = undefined;
  replace.mockClear();
  mutateRunSet.mockClear();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("AC-41: a never-run agent shows the never-run guidance, not zeroed metrics", () => {
    evalRuns = [];
    renderTab();
    expect(screen.getByText("This agent has never been run.")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("AC-23, AC-31: unknown metrics and unknown cost render the dash, never 0", () => {
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 2,
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
    ];
    renderTab();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("AC-26: an incomplete run carries its label in the history table", () => {
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1", "c2"],
        ran_at: "2026-08-01T00:00:00.000Z",
        finished_at: "2026-08-01T00:01:00.000Z",
        status: "incomplete",
        incomplete_reason: "One or more cases failed to execute",
        recall: 0.5,
        precision: 1,
        citation_accuracy: 1,
        cases_passed: 1,
        cases_covered: 2,
        cases_done: 2,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
    ];
    renderTab();
    expect(screen.getByText("incomplete")).toBeInTheDocument();
  });

  it("AC-34: the compare control states the requirement at 0 and 1 selections", () => {
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-01T00:00:00.000Z",
        finished_at: "2026-08-01T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
      {
        id: "run2",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-02T00:00:00.000Z",
        finished_at: "2026-08-02T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
    ];
    renderTab();
    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    expect(compareButton).toHaveAttribute("title", "Select exactly two runs to compare.");

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareButton).toBeDisabled();
    expect(compareButton).toHaveAttribute("title", "Select exactly two runs to compare — 1 selected.");

    fireEvent.click(checkboxes[1]!);
    expect(compareButton).not.toBeDisabled();
  });

  it("AC-48: closing the comparison returns focus to the Compare control", () => {
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-01T00:00:00.000Z",
        finished_at: "2026-08-01T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 0.5,
        precision: 1,
        citation_accuracy: 1,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
      {
        id: "run2",
        agent_id: "ag1",
        config_version: 1,
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
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
    ];
    comparisonData = {
      earlier: evalRuns[0],
      later: evalRuns[1],
      metrics: [
        { key: "recall", earlier: 0.5, later: 0.8, delta: 0.3 },
        { key: "precision", earlier: 1, later: 1, delta: 0 },
        { key: "citation_accuracy", earlier: 1, later: 1, delta: 0 },
      ],
      prompts: { earlier: "line one\nline two", later: "line one\nline three" },
      attributability: { case_set_changed: false, model_changed: false, attributable: true },
      detail_expired: false,
    };
    renderTab();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    const compareButton = screen.getByRole("button", { name: "Compare" });
    fireEvent.click(compareButton);

    expect(screen.getByText("Compare runs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));

    expect(screen.queryByText("Compare runs")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toHaveFocus();
  });

  it("AC-47: each trend series carries a text label, not colour alone", () => {
    evalRuns = [];
    evalTrend = [
      {
        set_run_id: "r1",
        config_version: 1,
        ran_at: "2026-08-01T00:00:00.000Z",
        recall: 0.5,
        precision: 0.8,
        citation_accuracy: 0.9,
        pass_rate: 0.5,
        cost_usd: 0.01,
      },
      {
        set_run_id: "r2",
        config_version: 2,
        ran_at: "2026-08-02T00:00:00.000Z",
        recall: 0.6,
        precision: 0.85,
        citation_accuracy: 0.95,
        pass_rate: 0.6,
        cost_usd: 0.02,
      },
    ];
    renderTab();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation")).toBeInTheDocument();
  });

  it("NFR-4, AC-31: running the set first confirms the case count and the previous cost, or that none is known", () => {
    evalCases = [{ id: "c1", name: "Case 1" }];
    evalRuns = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all cases (1)" }));
    expect(
      screen.getByText("Run 1 case? No previous cost is recorded."),
    ).toBeInTheDocument();
    expect(mutateRunSet).not.toHaveBeenCalled();

    // Scoped to the confirm dialog — a per-case row also has its own "Run" action.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));
    expect(mutateRunSet).toHaveBeenCalledTimes(1);
  });

  it("NFR-4: names the previous run's cost when one is known", () => {
    evalCases = [{ id: "c1", name: "Case 1" }];
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-01T00:00:00.000Z",
        finished_at: "2026-08-01T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.03,
        duration_ms: 1000,
        detail_expired: false,
      },
    ];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all cases (1)" }));
    expect(screen.getByText("Run 1 case? The previous run cost $0.03.")).toBeInTheDocument();
  });

  it("AC-33: comparing two runs shows three metric-pair deltas and both prompts with changed lines marked", () => {
    evalRuns = [
      {
        id: "run1",
        agent_id: "ag1",
        config_version: 1,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-01T00:00:00.000Z",
        finished_at: "2026-08-01T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 0.5,
        precision: 0.6,
        citation_accuracy: 0.7,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
      {
        id: "run2",
        agent_id: "ag1",
        config_version: 2,
        provider: "openrouter",
        model: "m",
        covered_case_ids: ["c1"],
        ran_at: "2026-08-02T00:00:00.000Z",
        finished_at: "2026-08-02T00:01:00.000Z",
        status: "complete",
        incomplete_reason: null,
        recall: 0.8,
        precision: 0.6,
        citation_accuracy: 0.9,
        cases_passed: 1,
        cases_covered: 1,
        cases_done: 1,
        cost_usd: 0.01,
        duration_ms: 1000,
        detail_expired: false,
      },
    ];
    comparisonData = {
      earlier: evalRuns[0],
      later: evalRuns[1],
      metrics: [
        { key: "recall", earlier: 0.5, later: 0.8, delta: 0.3 },
        { key: "precision", earlier: 0.6, later: 0.6, delta: 0 },
        { key: "citation_accuracy", earlier: 0.7, later: 0.9, delta: 0.2 },
      ],
      prompts: { earlier: "line one\nline two", later: "line one\nline three" },
      attributability: { case_set_changed: false, model_changed: false, attributable: true },
      detail_expired: false,
    };
    renderTab();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));

    // Three metric-pair deltas, each keyed by its metric name.
    expect(screen.getByText("recall")).toBeInTheDocument();
    expect(screen.getByText("precision")).toBeInTheDocument();
    expect(screen.getByText("citation_accuracy")).toBeInTheDocument();
    expect(screen.getByText("50% → 80%")).toBeInTheDocument();
    expect(screen.getByText("60% → 60%")).toBeInTheDocument();
    expect(screen.getByText("70% → 90%")).toBeInTheDocument();

    // Both system prompts render, with the changed lines marked — a shared
    // line ("line one") carries no inline style, a changed one does.
    const sharedLines = screen.getAllByText("line one");
    expect(sharedLines.length).toBe(2);
    sharedLines.forEach((el) => expect(el).not.toHaveAttribute("style"));
    expect(screen.getByText("line two")).toHaveAttribute("style");
    expect(screen.getByText("line three")).toHaveAttribute("style");
  });
});
