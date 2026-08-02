/**
 * PR list FINDINGS cell + its hover card (specs/findings-by-severity.md).
 *
 * The behaviour worth pinning: nothing is fetched until a hover actually
 * commits, the card lists every run's findings worst-first, and its header
 * count agrees with the badges beside it.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { HOVER_OPEN_DELAY_MS } from "@/components/findings-hover-card";

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (id: string | null) => usePrReviews(id),
}));

import { FindingsCell } from "./FindingsCell";

afterEach(cleanup);
beforeEach(() => {
  usePrReviews.mockReset();
  usePrReviews.mockReturnValue({ data: REVIEWS, isLoading: false });
});

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

function review(id: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    pr_id: "p1",
    agent_id: "a1",
    run_id: `run-${id}`,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "s",
    score: 61,
    model: "m",
    created_at: "2026-06-13T00:00:00Z",
    findings,
  };
}

/** Two runs, so the card has to flatten across them. */
const REVIEWS: ReviewRecord[] = [
  review("rev1", [finding({ id: "w1" })]),
  review("rev2", [
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
  ]),
];

const PR: PrMeta = {
  id: "p1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "deadbeef",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: "2026-06-13T00:00:00Z",
  updated_at: "2026-06-13T00:00:00Z",
  score: 61,
  cost_usd: 0.014,
  findings_by_severity: { CRITICAL: 1, WARNING: 1, SUGGESTION: 0 },
};

function renderCell(pr: PrMeta = PR) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsCell pr={pr} />
    </NextIntlClientProvider>,
  );
}

/** Hover the cell and let the open delay elapse. */
function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
  });
}

describe("FindingsCell hover card", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches nothing until a hover actually commits", () => {
    const { container } = renderCell();
    expect(usePrReviews).toHaveBeenCalledWith(null);

    // Brushing past without settling must not open the card, and must not fetch.
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 50);
    });
    fireEvent.mouseLeave(container.firstChild as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(usePrReviews).not.toHaveBeenCalledWith("p1");
  });

  it("opens after the delay and lists every run's findings, worst first", () => {
    const { container } = renderCell();
    hover(container.firstChild as HTMLElement);

    const card = screen.getByRole("tooltip");
    expect(usePrReviews).toHaveBeenCalledWith("p1");
    expect(card).toHaveTextContent("2 findings");

    // Flattened across rev1 + rev2, CRITICAL ahead of WARNING even though the
    // warning's review comes first.
    const titles = Array.from(card.querySelectorAll("span")).map((n) => n.textContent);
    const crit = titles.indexOf("Hardcoded Stripe secret key in commit");
    const warn = titles.indexOf("N+1 query in user list endpoint");
    expect(crit).toBeGreaterThan(-1);
    expect(warn).toBeGreaterThan(-1);
    expect(crit).toBeLessThan(warn);
  });

  it("shows each finding's file:line and confidence", () => {
    const { container } = renderCell();
    hover(container.firstChild as HTMLElement);
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
  });

  it("closes on mouse leave and on Escape", () => {
    const { container } = renderCell();
    const cell = container.firstChild as HTMLElement;

    hover(cell);
    fireEvent.mouseLeave(cell);
    expect(screen.queryByRole("tooltip")).toBeNull();

    hover(cell);
    fireEvent.keyDown(cell, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open for a PR with no findings", () => {
    const { container } = renderCell({
      ...PR,
      findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    });
    hover(container.firstChild as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("does not open for a PR that has never been reviewed", () => {
    const { container } = renderCell({ ...PR, findings_by_severity: null });
    hover(container.firstChild as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says so while the findings are still in flight", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderCell();
    hover(container.firstChild as HTMLElement);
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();
  });

  // The card is a hover affordance, but the row is keyboard-reachable, so the
  // findings must not be pointer-only.
  it("opens on keyboard focus too", () => {
    const { container } = renderCell();
    fireEvent.focus(container.firstChild as HTMLElement);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
