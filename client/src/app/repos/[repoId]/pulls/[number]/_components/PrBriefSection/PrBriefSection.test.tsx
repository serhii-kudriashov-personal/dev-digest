/**
 * PrBriefSection — the Overview tab's top section: the Risk Brief's `what` +
 * `why` as one plain description, always shown once a brief exists —
 * independent of whether any review has run — plus, once a review with a
 * verdict exists, that review's verdict/findings/blockers/agent/score wrapped
 * around the SAME text via `VerdictBanner` (never `review.summary`). Also
 * owns the regenerate control, in both branches — pinned as ABSENT from
 * `BriefBar` (`BriefBar.test.tsx`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrRiskBriefRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { PrBriefSection } from "./PrBriefSection";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop calls db.posts.findMany once per user.",
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

const BRIEF: PrRiskBriefRecord = {
  pr_id: "pr-1",
  what: "Adds a per-route rate limiter to the public API.",
  why: "Repeated abusive traffic was degrading the shared database pool.",
  risk_level: "medium",
  risks: [],
  review_focus: [],
  head_sha: "sha-current",
  generated_at: "2026-08-16T10:00:00.000Z",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash-0731",
  cost_usd: 0.0031,
  input_tokens: 1200,
  tokens_estimated: false,
  included_inputs: ["pr_identity"],
  missing_inputs: [],
  dropped_refs: 0,
  index_complete: true,
  index_reason: null,
  stale: false,
};

const REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary:
    "Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.",
  score: 61,
  model: "deepseek/deepseek-v4-flash-0731",
  grounding: null,
  created_at: "2026-08-17T10:00:00.000Z",
  findings: [
    finding({ id: "c1", severity: "CRITICAL" }),
    finding({ id: "c2", severity: "CRITICAL", dismissed_at: "2026-08-17T11:00:00.000Z" }),
    finding({ id: "w1", severity: "WARNING" }),
  ],
};

function renderSection(props: Partial<React.ComponentProps<typeof PrBriefSection>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, brief: briefMessages }}>
      <PrBriefSection
        brief={BRIEF}
        briefLoading={false}
        generating={false}
        onGenerate={() => {}}
        review={REVIEW}
        costUsd={0.014}
        tokensIn={8200}
        onOpenRun={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefSection", () => {
  it("renders nothing while the brief query is still loading", () => {
    const { container } = renderSection({ briefLoading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no brief has been generated, even if a review exists", () => {
    const { container } = renderSection({ brief: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the what+why text when a brief exists but no review has run yet", () => {
    renderSection({ review: null });
    expect(screen.getByText(`${BRIEF.what} ${BRIEF.why}`)).toBeInTheDocument();
    // No review data at all — no verdict, no score, no agent, no run link.
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText("61")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view run details/i })).not.toBeInTheDocument();
  });

  it("shows only the what+why text for a review with no verdict, same as no review", () => {
    renderSection({ review: { ...REVIEW, verdict: null } });
    expect(screen.getByText(`${BRIEF.what} ${BRIEF.why}`)).toBeInTheDocument();
    expect(screen.queryByText("61")).not.toBeInTheDocument();
  });

  it("shows the what+why text as VerdictBanner's summary, NOT review.summary, once a review exists", () => {
    renderSection();
    expect(screen.getByText(`${BRIEF.what} ${BRIEF.why}`)).toBeInTheDocument();
    expect(screen.queryByText(REVIEW.summary!)).not.toBeInTheDocument();
  });

  it("shows the review's verdict and score alongside the text once a review exists", () => {
    renderSection();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("counts only non-dismissed CRITICAL findings as blockers, not every CRITICAL", () => {
    renderSection();
    // 3 findings total, but only ONE of the two criticals is a live blocker.
    expect(screen.getByText(/3 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("shows the run's cost and token count, joined by run_id rather than read off the review", () => {
    renderSection();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8,200 tok")).toBeInTheDocument();
  });

  it("omits the token count when it is unknown, without rendering a stray separator", () => {
    renderSection({ tokensIn: null });
    expect(screen.queryByText(/tok$/)).not.toBeInTheDocument();
  });

  it("calls onOpenRun when 'View run details' is activated", async () => {
    const user = userEvent.setup();
    const onOpenRun = vi.fn();
    renderSection({ onOpenRun });

    await user.click(screen.getByRole("button", { name: /view run details/i }));
    expect(onOpenRun).toHaveBeenCalledTimes(1);
  });

  it("shows a regenerate control beside the title and calls onGenerate, with a review present", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    renderSection({ onGenerate });

    await user.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows the same regenerate control with no review at all, and disables it while generating", () => {
    renderSection({ review: null, generating: true });
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();
  });
});
