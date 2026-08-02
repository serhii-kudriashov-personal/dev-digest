/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { HOVER_OPEN_DELAY_MS } from "@/components/findings-hover-card";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — cost badge", () => {
  it("a settled run shows its token count and cost together", () => {
    renderRuns([run({ status: "done", tokens_in: 9119, cost_usd: 0.00128 })]);
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it('a settled run with no cost data shows "—", never "$0.00"', () => {
    renderRuns([run({ status: "done", tokens_in: 9119, cost_usd: null })]);
    expect(screen.getByText("9,119 tok · —")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00\b/)).not.toBeInTheDocument();
  });

  it("does not show a cost line for an unsettled run", () => {
    renderRuns([run({ status: "running", tokens_in: 0, cost_usd: null, score: null })]);
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});

/**
 * Severity badges + hover card (specs/findings-by-severity.md). `RunSummary`
 * carries only a total, so the breakdown is joined on the client from the
 * reviews already on the page — which means a run can legitimately have NO
 * entry, and must then keep its plain-text count rather than render nothing.
 */
describe("RunHistory — findings breakdown", () => {
  function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
    return {
      severity: "WARNING",
      category: "perf",
      title: "N+1 query in user list endpoint",
      file: "src/api/users.ts",
      start_line: 45,
      end_line: 52,
      rationale: "The loop on line 46 calls db.posts.findMany once per user.",
      suggestion: null,
      confidence: 0.86,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "r1",
      accepted_at: null,
      dismissed_at: null,
      ...over,
    };
  }

  const FINDINGS: FindingRecord[] = [
    finding({ id: "w1" }),
    finding({
      id: "c1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key in commit",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      confidence: 0.98,
    }),
  ];

  function renderWithFindings(
    runs: RunSummary[],
    byRun: Map<string, FindingRecord[]>,
  ) {
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={runs} findingsByRun={byRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
  }

  const group = () => screen.getByRole("group", { name: "Findings breakdown" });

  it("renders a badge per severity instead of the plain-text count", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 2, blockers: 1, score: 40 })],
      new Map([["run-1", FINDINGS]]),
    );
    const g = group();
    // One CRITICAL and one WARNING, so two badges each reading 1.
    expect(within(g).getAllByText("1")).toHaveLength(2);
    expect(screen.queryByText("2 finding(s)")).not.toBeInTheDocument();
    // The run's own blocker count is untouched beside them.
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("keeps the plain-text count for a run with no review record", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 5, blockers: 0, score: 40 })],
      new Map(),
    );
    expect(screen.getByText("5 finding(s)")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Findings breakdown" })).toBeNull();
  });

  it("reads 'None' for a run whose review found nothing", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 0, blockers: 0, score: 95 })],
      new Map([["run-1", []]]),
    );
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(group()).not.toHaveAttribute("tabindex");
  });

  describe("hover card", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("lists that run's findings worst-first, with no fetch", () => {
      renderWithFindings(
        [run({ status: "done", findings_count: 2, blockers: 1, score: 40 })],
        new Map([["run-1", FINDINGS]]),
      );
      fireEvent.mouseEnter(group());
      act(() => {
        vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
      });

      const card = screen.getByRole("tooltip");
      expect(card).toHaveTextContent("2 findings");
      const titles = Array.from(card.querySelectorAll("span")).map((n) => n.textContent);
      const crit = titles.indexOf("Hardcoded Stripe secret key in commit");
      const warn = titles.indexOf("N+1 query in user list endpoint");
      expect(crit).toBeGreaterThan(-1);
      expect(crit).toBeLessThan(warn);
      expect(within(card).getByText("src/config.ts:12")).toBeInTheDocument();
    });

    // Each row carries its own card; opening one must not show the other's.
    it("shows only the hovered run's findings when several runs are listed", () => {
      renderWithFindings(
        [
          run({ run_id: "run-1", status: "done", findings_count: 2, score: 40 }),
          run({ run_id: "run-2", status: "done", findings_count: 1, score: 80, ran_at: "2026-06-11T17:00:00.000Z" }),
        ],
        new Map([
          ["run-1", FINDINGS],
          ["run-2", [finding({ id: "s1", severity: "SUGGESTION", title: "Extract magic number" })]],
        ]),
      );
      const groups = screen.getAllByRole("group", { name: "Findings breakdown" });
      fireEvent.mouseEnter(groups[1]!);
      act(() => {
        vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
      });

      const card = screen.getByRole("tooltip");
      expect(within(card).getByText("Extract magic number")).toBeInTheDocument();
      expect(within(card).queryByText("Hardcoded Stripe secret key in commit")).toBeNull();
    });
  });
});
