/**
 * BriefBar — the header row: status, risk level, the risks list, and the
 * input accounting. Asserts what the user sees, never hook internals or CSS.
 * The `what`/`why` text, the regenerate control, and the review-focus list
 * are pinned as ABSENT here — they live in `PrBriefSection` (the Overview
 * tab's top section) and `ReviewFocusSection` respectively.
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
import { BriefBar } from "./BriefBar";

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
  dropped_refs: 2,
  index_complete: true,
  index_reason: null,
  stale: false,
};

function renderBar(props: Partial<React.ComponentProps<typeof BriefBar>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, blast: blastMessages }}>
      <BriefBar
        brief={BRIEF}
        loading={false}
        generating={false}
        result={undefined}
        onGenerate={() => {}}
        onOpenCaller={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("BriefBar", () => {
  it("renders nothing while the query is still loading", () => {
    const { container } = renderBar({ brief: null, loading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the empty state and calls onGenerate, naming the action (AC-26, AC-50)", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    renderBar({ brief: null, onGenerate });

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate brief/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows a generating state with no brief, and offers no generate button (AC-27)", () => {
    renderBar({ brief: null, generating: true });
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
  });

  it("keeps the previous brief readable while a regeneration is in flight elsewhere", () => {
    renderBar({ generating: true });
    expect(screen.getByText(BRIEF.risks[0]!.title)).toBeInTheDocument();
  });

  it("renders no regenerate control — that moved to PrBriefSection on the Overview tab", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  it("renders the risk level as a text label beside the colour (AC-28, AC-46)", () => {
    renderBar();
    expect(screen.getByText("Risk: Medium")).toBeInTheDocument();
  });

  it("renders no what/why text — that moved to PrBriefSection on the Overview tab", () => {
    renderBar();
    expect(screen.queryByText(BRIEF.what)).not.toBeInTheDocument();
    expect(screen.queryByText(BRIEF.why)).not.toBeInTheDocument();
  });

  it("labels the brief as model-generated (AC-41, AC-46)", () => {
    renderBar();
    expect(screen.getByText("Model-generated")).toBeInTheDocument();
  });

  it("shows the cost, and 'unknown' rather than zero when it cannot be attributed (AC-40, AC-46)", () => {
    renderBar();
    expect(screen.getByText(/Cost: \$0.003/)).toBeInTheDocument();

    cleanup();
    renderBar({ brief: { ...BRIEF, cost_usd: null } });
    expect(screen.getByText("Cost: unknown")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00\b/)).not.toBeInTheDocument();
  });

  it("names an optional input that was absent, without treating it as an error (AC-37, AC-46)", () => {
    renderBar();
    expect(screen.getByText("Missing inputs:")).toBeInTheDocument();
    expect(screen.getByText("Derived intent")).toBeInTheDocument();
    expect(screen.getByText("Linked issue")).toBeInTheDocument();
  });

  it("names incomplete downstream impact next to the risk level, and does not read as reassuring (AC-36)", () => {
    renderBar({ brief: { ...BRIEF, index_complete: false, index_reason: "index_partial" } });
    expect(screen.getByText("The index is incomplete, so some callers may be missing.")).toBeInTheDocument();
  });

  it("marks the brief stale and names regenerate as the fix (AC-34/AC-35, AC-46)", () => {
    renderBar({ brief: { ...BRIEF, stale: true } });
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText("New activity since this brief was generated — regenerate for a current read."),
    ).toBeInTheDocument();
  });

  it("shows a too-large state with no brief and no retry (AC-42 overflow sibling)", () => {
    const result: BriefGenerationResult = { state: "too_large", identity_tokens: 9000, budget: 8000 };
    renderBar({ brief: null, result });
    expect(screen.getByText("Too large to brief")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a retryable failure with no brief, and calling it retries generation (AC-38)", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const result: BriefGenerationResult = { state: "failed", reason: "provider_error" };
    renderBar({ brief: null, result, onGenerate });

    expect(screen.getByText("Brief generation failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("names Settings and offers no retry when the feature is not configured (AC-39)", () => {
    const result: BriefGenerationResult = { state: "not_configured" };
    renderBar({ brief: null, result });

    expect(screen.getByText("Risk brief is not configured")).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a non-zero dropped-reference count, and shows no count at all for zero (SPEC-02 AC-20, SPEC-03 AC-46)", () => {
    renderBar();
    expect(screen.getByText("2 reference(s) dropped as unresolvable")).toBeInTheDocument();

    cleanup();
    renderBar({ brief: { ...BRIEF, dropped_refs: 0 } });
    expect(screen.queryByText(/reference\(s\) dropped/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it("labels the inputs the brief DID use, distinctly from the missing ones (AC-46)", () => {
    renderBar();
    expect(screen.getByText("Inputs used:")).toBeInTheDocument();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Findings")).toBeInTheDocument();
    // Distinct from the missing-inputs row.
    expect(screen.getByText("Missing inputs:")).toBeInTheDocument();
  });

  it("renders no review-focus list — that section lives in ReviewFocusSection", () => {
    renderBar();
    expect(screen.queryByText(/Read this first/)).not.toBeInTheDocument();
  });

  it("shows the brief's risks, each with its severity as a text label beside the colour", () => {
    renderBar();
    expect(screen.getByText(BRIEF.risks[0]!.title)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.risks[0]!.explanation)).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("states explicitly that no risk was identified, rather than an empty area (SPEC-02 AC-43)", () => {
    renderBar({ brief: { ...BRIEF, risks: [] } });
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("shows a risk's file_refs as clickable paths and opens each in the diff at line 1", async () => {
    const user = userEvent.setup();
    const onOpenCaller = vi.fn();
    renderBar({ onOpenCaller });

    const path = BRIEF.risks[0]!.file_refs[0]!;
    const button = screen.getByRole("button", { name: new RegExp(`Open ${path}`, "i") });
    expect(button).toHaveTextContent(path);

    await user.click(button);
    expect(onOpenCaller).toHaveBeenCalledWith(path, 1);
  });

  it("renders no file_refs row for a risk that carries none", () => {
    renderBar({
      brief: {
        ...BRIEF,
        risks: [{ ...BRIEF.risks[0]!, file_refs: [] }],
      },
    });
    expect(screen.queryByText("server/src/platform/rate-limit.ts")).not.toBeInTheDocument();
  });
});
