/**
 * Review Runs header — the per-severity badges and their hover card
 * (specs/findings-by-severity.md).
 *
 * The header reads the same way as the PR list's FINDINGS cell, with one
 * difference worth pinning: this run's findings are already in memory, so the
 * card must render them without any fetch.
 *
 * Depth note: `messages/` is `../` × 8 from here, not × 7 as under
 * `pulls/_components/` (client/INSIGHTS.md, 2026-08-02).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { HOVER_OPEN_DELAY_MS } from "@/components/findings-hover-card";

const mutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate, isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

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

/** Two criticals — one of them dismissed — one warning, no suggestions. */
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
  finding({
    id: "c2",
    severity: "CRITICAL",
    title: "Triaged critical",
    dismissed_at: "2026-06-13T00:00:00Z",
  }),
];

function review(findings: FindingRecord[]): ReviewRecord {
  return {
    id: "rev1",
    pr_id: "p1",
    agent_id: "a1",
    run_id: "run-1",
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

function renderAccordion(findings: FindingRecord[] = FINDINGS) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={review(findings)} prId="p1" />
    </NextIntlClientProvider>,
  );
}

/** The badge group in the header, and a hover that settles. */
const group = () => screen.getByRole("group", { name: "Findings breakdown" });
function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS);
  });
}

describe("ReviewRunAccordion header findings", () => {
  it("shows one badge per severity this run found, zero levels omitted", () => {
    renderAccordion();
    const g = group();
    // 2 CRITICAL, 1 WARNING, no SUGGESTION badge at all.
    expect(within(g).getByText("2")).toBeInTheDocument();
    expect(within(g).getByText("1")).toBeInTheDocument();
    expect(within(g).queryByText("0")).toBeNull();
  });

  // The breakdown counts what the run FOUND; `blockers` drives the verdict and
  // excludes dismissed. Both are on screen, and they disagree on purpose.
  it("counts a dismissed critical in the badges but not in the blockers", () => {
    renderAccordion();
    expect(within(group()).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
  });

  it("reads 'None' and is inert for a run that found nothing", () => {
    renderAccordion([]);
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(group()).not.toHaveAttribute("tabindex");
  });
});

describe("ReviewRunAccordion header hover card", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists this run's findings worst-first, without any fetch", () => {
    renderAccordion();
    hover(group());

    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("3 findings");
    const titles = Array.from(card.querySelectorAll("span")).map((n) => n.textContent);
    const crit = titles.indexOf("Hardcoded Stripe secret key in commit");
    const warn = titles.indexOf("N+1 query in user list endpoint");
    expect(crit).toBeGreaterThan(-1);
    expect(crit).toBeLessThan(warn);
    expect(within(card).getByText("src/config.ts:12")).toBeInTheDocument();
    expect(within(card).getByText("98% conf")).toBeInTheDocument();
  });

  it("does not open for a run with no findings", () => {
    renderAccordion([]);
    hover(group());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // The header toggles the accordion on click; opening the card must not.
  it("closes on leave and on Escape, and leaves the accordion collapsed", () => {
    renderAccordion();
    const g = group();

    hover(g);
    fireEvent.mouseLeave(g);
    expect(screen.queryByRole("tooltip")).toBeNull();

    hover(g);
    fireEvent.keyDown(g, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Body still closed — no FindingsPanel toolbar rendered.
    expect(screen.queryByText("Hide low confidence")).toBeNull();
  });
});
