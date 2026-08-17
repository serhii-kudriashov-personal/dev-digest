/**
 * BriefCard — the why + risk summary and its "read this first" entries.
 * Asserts what the user sees, never hook internals or CSS.
 *
 * Interactions go through `userEvent`, matching `IntentCard.test.tsx`
 * (client/INSIGHTS.md 2026-08-08: the eight pre-existing `fireEvent` files are
 * deliberately not migrated, but new files use `userEvent`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BriefGenerationResult, PrRiskBriefRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BriefCard } from "./BriefCard";

afterEach(cleanup);

const BRIEF: PrRiskBriefRecord = {
  pr_id: "pr-1",
  what: "Adds a per-route rate limiter to the public API.",
  why: "Repeated abusive traffic was degrading the shared database pool.",
  risk_level: "medium",
  risks: [
    {
      title: "Limiter state is in-process",
      explanation: "A multi-instance deploy would let each instance count separately.",
      severity: "medium",
      file_refs: ["server/src/platform/rate-limit.ts"],
      endpoint_refs: [],
    },
  ],
  review_focus: [
    { path: "server/src/platform/rate-limit.ts", line: 12, reason: "The limiter's own bucket logic" },
  ],
  head_sha: "sha-current",
  generated_at: "2026-08-16T10:00:00.000Z",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash-0731",
  cost_usd: 0.0031,
  input_tokens: 1200,
  tokens_estimated: false,
  included_inputs: ["pr_identity", "blast_radius", "findings"],
  missing_inputs: ["derived_intent", "linked_issue", "linked_spec"],
  dropped_refs: 0,
  index_complete: true,
  index_reason: null,
  stale: false,
};

function renderCard(props: Partial<React.ComponentProps<typeof BriefCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, blast: blastMessages }}>
      <BriefCard
        brief={BRIEF}
        loading={false}
        generating={false}
        result={undefined}
        onGenerate={() => {}}
        onOpenFocus={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("BriefCard", () => {
  it("renders nothing while the query is still loading", () => {
    const { container } = renderCard({ brief: null, loading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the empty state and calls onGenerate, naming the action (AC-26)", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    renderCard({ brief: null, onGenerate });

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate brief/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows a generating state with no brief, and no error", () => {
    renderCard({ brief: null, generating: true });
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
  });

  it("keeps the previous brief readable while generating, and disables the regenerate control (AC-27)", () => {
    renderCard({ generating: true });

    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();
  });

  it("renders the risk level as a text label beside the colour (AC-28)", () => {
    renderCard();
    expect(screen.getByText("Risk: Medium")).toBeInTheDocument();
  });

  it("labels What and Why separately, each beside its own prose", () => {
    renderCard();
    expect(screen.getByText("What")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText("Why")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.why)).toBeInTheDocument();
  });

  it("labels the review-focus list as Review Focus — Read this first", () => {
    renderCard();
    expect(screen.getByText("Review Focus — Read this first")).toBeInTheDocument();
  });

  it("labels the brief as model-generated (AC-41)", () => {
    renderCard();
    expect(screen.getByText("Model-generated")).toBeInTheDocument();
  });

  it("shows the cost, and 'unknown' rather than zero when it cannot be attributed (AC-40)", () => {
    renderCard();
    expect(screen.getByText(/Cost: \$0.003/)).toBeInTheDocument();

    cleanup();
    renderCard({ brief: { ...BRIEF, cost_usd: null } });
    expect(screen.getByText("Cost: unknown")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00\b/)).not.toBeInTheDocument();
  });

  it("states explicitly that no risk was identified, rather than an empty area (AC-43)", () => {
    renderCard({ brief: { ...BRIEF, risks: [] } });
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("states explicitly that there is no review focus, rather than an empty area", () => {
    renderCard({ brief: { ...BRIEF, review_focus: [] } });
    expect(screen.getByText("No specific lines to start with.")).toBeInTheDocument();
  });

  it("activates a review-focus entry with an accessible name, calling onOpenFocus once with its path and line (AC-30, AC-33)", async () => {
    const user = userEvent.setup();
    const onOpenFocus = vi.fn();
    renderCard({ onOpenFocus });

    const entry = screen.getByRole("button", {
      name: "Open server/src/platform/rate-limit.ts line 12 in the diff",
    });
    await user.click(entry);

    expect(onOpenFocus).toHaveBeenCalledTimes(1);
    expect(onOpenFocus).toHaveBeenCalledWith("server/src/platform/rate-limit.ts", 12);
  });

  it("keeps a long path readable, with the full value reachable via its title (AC-44)", () => {
    const longPath =
      "server/src/modules/some/very/deeply/nested/directory/structure/that/keeps/going/rate-limit-config.ts";
    renderCard({
      brief: {
        ...BRIEF,
        review_focus: [{ path: longPath, line: 3, reason: "why" }],
      },
    });
    expect(screen.getByTitle(longPath)).toHaveTextContent(`${longPath}:3`);
  });

  it("names an optional input that was absent, without treating it as an error (AC-37)", () => {
    renderCard();
    expect(screen.getByText("Missing inputs:")).toBeInTheDocument();
    expect(screen.getByText("Derived intent")).toBeInTheDocument();
    expect(screen.getByText("Linked issue")).toBeInTheDocument();
  });

  it("names incomplete downstream impact next to the risk level, and does not read as reassuring (AC-36)", () => {
    renderCard({ brief: { ...BRIEF, index_complete: false, index_reason: "index_partial" } });
    expect(screen.getByText("The index is incomplete, so some callers may be missing.")).toBeInTheDocument();
  });

  it("marks the brief stale and names regenerate as the fix (AC-34/AC-35)", () => {
    renderCard({ brief: { ...BRIEF, stale: true } });
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText("New activity since this brief was generated — regenerate for a current read."),
    ).toBeInTheDocument();
  });

  it("shows a too-large state with no brief and no retry", () => {
    const result: BriefGenerationResult = { state: "too_large", identity_tokens: 9000, budget: 8000 };
    renderCard({ brief: null, result });
    expect(screen.getByText("Too large to brief")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a retryable failure with no brief, and calling it retries generation (AC-38)", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const result: BriefGenerationResult = { state: "failed", reason: "provider_error" };
    renderCard({ brief: null, result, onGenerate });

    expect(screen.getByText("Brief generation failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("names Settings and offers no retry when the feature is not configured (AC-39)", () => {
    const result: BriefGenerationResult = { state: "not_configured" };
    renderCard({ brief: null, result });

    expect(screen.getByText("Risk brief is not configured")).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
