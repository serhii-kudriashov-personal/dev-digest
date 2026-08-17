/**
 * ReviewFocusSection — the standalone "read this first" section. Asserts what
 * the user sees, never hook internals or CSS.
 *
 * Interactions go through `userEvent`, matching `IntentCard.test.tsx`
 * (client/INSIGHTS.md 2026-08-08: the eight pre-existing `fireEvent` files are
 * deliberately not migrated, but new files use `userEvent`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrRiskBriefRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ReviewFocusSection } from "./ReviewFocusSection";

afterEach(cleanup);

const BRIEF: PrRiskBriefRecord = {
  pr_id: "pr-1",
  what: "Adds a per-route rate limiter to the public API.",
  why: "Repeated abusive traffic was degrading the shared database pool.",
  risk_level: "medium",
  risks: [],
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

function renderSection(props: Partial<React.ComponentProps<typeof ReviewFocusSection>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocusSection brief={BRIEF} loading={false} onOpenFocus={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocusSection", () => {
  it("labels the section as Review Focus — Read this first (SPEC-02 AC-45)", () => {
    renderSection();
    expect(screen.getByText("Review Focus — Read this first")).toBeInTheDocument();
  });

  it("states explicitly that there is no review focus, rather than an empty area (SPEC-02 AC-21)", () => {
    renderSection({ brief: { ...BRIEF, review_focus: [] } });
    expect(screen.getByText("No specific lines to start with.")).toBeInTheDocument();
  });

  it("activates a review-focus entry with an accessible name, calling onOpenFocus once with its path and line (SPEC-02 AC-30, AC-33)", async () => {
    const user = userEvent.setup();
    const onOpenFocus = vi.fn();
    renderSection({ onOpenFocus });

    const entry = screen.getByRole("button", {
      name: "Open server/src/platform/rate-limit.ts line 12 in the diff",
    });
    await user.click(entry);

    expect(onOpenFocus).toHaveBeenCalledTimes(1);
    expect(onOpenFocus).toHaveBeenCalledWith("server/src/platform/rate-limit.ts", 12);
  });

  it("keeps a long path readable, with the full value reachable via its title (SPEC-02 AC-44)", () => {
    const longPath =
      "server/src/modules/some/very/deeply/nested/directory/structure/that/keeps/going/rate-limit-config.ts";
    renderSection({
      brief: {
        ...BRIEF,
        review_focus: [{ path: longPath, line: 3, reason: "why" }],
      },
    });
    expect(screen.getByTitle(longPath)).toHaveTextContent(`${longPath}:3`);
  });

  it("renders nothing at all — no heading, no error, no empty box — for a never-briefed PR (SPEC-03 AC-48, AC-50)", () => {
    const { container } = renderSection({ brief: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at all while the query is still loading (SPEC-03 AC-48, AC-50)", () => {
    const { container } = renderSection({ loading: true });
    expect(container).toBeEmptyDOMElement();
  });
});
