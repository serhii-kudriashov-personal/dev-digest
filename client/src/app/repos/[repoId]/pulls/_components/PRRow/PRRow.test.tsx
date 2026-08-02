/**
 * PR list row — the FINDINGS cell (specs/findings-by-severity.md). The rule the
 * cell has to keep straight is the difference between three states: never
 * reviewed, reviewed-and-clean, and reviewed-with-findings.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// FindingsCell lazily fetches the hover card's findings; the counts under test
// come from PrMeta, so stub the query rather than stand up a QueryClient.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: undefined, isLoading: false }),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(over: Partial<PrMeta> = {}): PrMeta {
  return {
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
    findings_by_severity: { CRITICAL: 2, WARNING: 2, SUGGESTION: 2 },
    ...over,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={meta} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow findings cell", () => {
  it("renders a count per severity", () => {
    const { container } = renderRow(pr());
    // In compact mode SeverityBadge is icon + count, so the counts are the
    // only text the cell contributes.
    expect(within(container).getAllByText("2")).toHaveLength(3);
  });

  it("omits a level with a zero count", () => {
    const { container } = renderRow(
      pr({ findings_by_severity: { CRITICAL: 0, WARNING: 2, SUGGESTION: 4 } }),
    );
    expect(within(container).getByText("2")).toBeInTheDocument();
    expect(within(container).getByText("4")).toBeInTheDocument();
    expect(within(container).queryByText("0")).toBeNull();
  });

  it("reads 'None' for a reviewed PR that found nothing", () => {
    renderRow(pr({ findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }));
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("reads em-dash for a PR that has never been reviewed", () => {
    renderRow(pr({ findings_by_severity: null, score: null, cost_usd: null }));
    expect(screen.queryByText("None")).toBeNull();
    // score, cost and findings all render "—" for an unreviewed PR.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
