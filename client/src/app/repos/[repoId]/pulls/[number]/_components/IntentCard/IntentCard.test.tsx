/**
 * IntentCard — the surface where the author checks the system understood the
 * task. Asserts what the user sees, never hook internals or CSS.
 *
 * Interactions go through `userEvent`, which simulates the full pointer/focus
 * sequence a real user produces — `fireEvent` dispatches a single DOM event and
 * so passes on controls a real click could not reach. The package was added as
 * a test-only devDependency for this file (client/INSIGHTS.md, 2026-08-08); the
 * eight pre-existing `fireEvent` files are deliberately NOT migrated here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const INTENT: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Add rate limiting to the public API endpoints.",
  in_scope: ["a limiter on /api routes", "config for the limiter"],
  out_of_scope: ["the admin endpoints, deferred to a follow-up"],
  head_sha: "sha-original",
  confidence: "high",
  model_confidence: 0.95,
  sources: ["pr_title_body", "linked_issue"],
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash-0731",
  generated_at: "2026-08-08T10:00:00.000Z",
  stale: false,
};

function renderCard(props: Partial<React.ComponentProps<typeof IntentCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <IntentCard
        intent={INTENT}
        loading={false}
        stale={false}
        deriving={false}
        onDerive={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the intent, both scope lists and the deterministic confidence tier", () => {
    renderCard();

    expect(screen.getByText("Add rate limiting to the public API endpoints.")).toBeInTheDocument();

    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("a limiter on /api routes")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(
      screen.getByText("the admin endpoints, deferred to a follow-up"),
    ).toBeInTheDocument();

    // The DETERMINISTIC tier is shown …
    expect(screen.getByText("Confidence: High")).toBeInTheDocument();
    // … and the model's own self-rating is deliberately never rendered.
    expect(screen.queryByText(/0\.95/)).not.toBeInTheDocument();

    // Source LABELS, not the content they came from.
    expect(screen.getByText("PR title and description")).toBeInTheDocument();
    expect(screen.getByText("Linked issue")).toBeInTheDocument();
  });

  it("shows the stale badge and calls onDerive when Re-derive is clicked", async () => {
    // `setup()` per test, never in a shared beforeEach — each test gets its own
    // pointer/keyboard state.
    const user = userEvent.setup();
    const onDerive = vi.fn();
    renderCard({ stale: true, onDerive });

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText("The PR has changed since this was derived."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /re-derive/i }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("shows the unavailable empty state when no intent has been derived", () => {
    renderCard({ intent: null });

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Run a review or open the PR to compute it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /derive intent/i })).toBeInTheDocument();
    // Nothing from a derived intent leaks into the empty state.
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();
  });

  it("renders nothing while the query is still loading", () => {
    const { container } = renderCard({ intent: null, loading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders no Risks heading — that section lives in BriefBar now", () => {
    renderCard();
    expect(screen.getByText("Add rate limiting to the public API endpoints.")).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.queryByText("Risks")).not.toBeInTheDocument();
  });
});
