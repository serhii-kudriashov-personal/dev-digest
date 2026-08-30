/**
 * PR list row — the FINDINGS cell (specs/findings-by-severity.md). The rule the
 * cell has to keep straight is the difference between three states: never
 * reviewed, reviewed-and-clean, and reviewed-with-findings.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, Repo } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../messages/en/common.json";

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

/** The owning repository, in the shape the row actually reads (AC-26, AC-27, AC-31). */
type RowRepo = Pick<Repo, "provider" | "instance_label">;

function renderRow(meta: PrMeta, repo?: RowRepo) {
  return render(
    // `common` carries the forge vocabulary — the identifier prefix and the
    // "on {instance}" phrase — which is a different catalogue from `prReview`.
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, common: commonMessages }}>
      <PRRow pr={meta} repoId="r1" repo={repo} />
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

/**
 * SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) — AC-26, AC-27, AC-31.
 *
 * The row is where a user first meets a change request, so it is where naming it
 * wrong costs the most: `#17` on a merge request is a reference that does not
 * exist on the instance, and a row that never says which host it came from is
 * ambiguous the moment a workspace holds two.
 */
describe("PRRow forge identity", () => {
  const GITLAB: RowRepo = { provider: "gitlab", instance_label: "Acme GitLab" };
  const GITHUB: RowRepo = { provider: "github", instance_label: "github.com" };

  it("prefixes a GitLab change request with ! (AC-26)", () => {
    renderRow(pr({ number: 17 }), GITLAB);
    expect(screen.getByText("!17")).toBeInTheDocument();
    expect(screen.queryByText("#17")).toBeNull();
  });

  it("prefixes a GitHub pull request with # (AC-27)", () => {
    renderRow(pr({ number: 17 }), GITHUB);
    expect(screen.getByText("#17")).toBeInTheDocument();
    expect(screen.queryByText("!17")).toBeNull();
  });

  it("falls back to the GitHub form while the repository is still loading (AC-19)", () => {
    // Every pre-feature workspace is GitHub, so the honest default is `#` —
    // not a blank prefix that shifts the layout once the repo query resolves.
    renderRow(pr({ number: 17 }));
    expect(screen.getByText("#17")).toBeInTheDocument();
  });

  it("names the instance the row came from, as text (AC-31)", () => {
    renderRow(pr(), GITLAB);
    expect(screen.getByText("on Acme GitLab")).toBeInTheDocument();
  });

  it("takes the instance from the owning repository, not from a constant", () => {
    renderRow(pr(), { provider: "gitlab", instance_label: "Team GitLab" });
    expect(screen.getByText("on Team GitLab")).toBeInTheDocument();
    expect(screen.queryByText("on Acme GitLab")).toBeNull();
  });
});
