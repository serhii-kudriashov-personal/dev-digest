import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [finding({ id: "f1" })];

/** One of each severity, plus a second CRITICAL that only low confidence hides. */
const MIXED: FindingRecord[] = [
  finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret" }),
  finding({ id: "c2", severity: "CRITICAL", title: "Unsure critical", confidence: 0.2 }),
  finding({ id: "w1", severity: "WARNING", title: "N+1 query" }),
  finding({ id: "s1", severity: "SUGGESTION", title: "Extract magic number" }),
  finding({ id: "s2", severity: "SUGGESTION", title: "Rename helper" }),
];

/** The chip for one severity, located via the filter bar's accessible group. */
function chip(label: string): HTMLElement {
  const group = screen.getByRole("group", { name: "Filter findings by severity" });
  return within(group).getByRole("button", { name: new RegExp(`^${label}`) });
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("omits the filter bar when the page does not own a selection", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.queryByRole("group", { name: "Filter findings by severity" })).toBeNull();
  });
});

describe("FindingsPanel severity filter", () => {
  const renderPanel = (props: Partial<React.ComponentProps<typeof FindingsPanel>> = {}) =>
    renderWithIntl(
      <FindingsPanel
        findings={MIXED}
        prId="pr1"
        severities={[]}
        onToggleSeverity={vi.fn()}
        {...props}
      />,
    );

  it("counts this run's findings per severity", () => {
    renderPanel();
    expect(chip("Critical")).toHaveTextContent("2");
    expect(chip("Warning")).toHaveTextContent("1");
    expect(chip("Suggestion")).toHaveTextContent("2");
  });

  it("shows only the selected severities, and composes two as a union", () => {
    const { unmount } = renderPanel({ severities: ["CRITICAL"] });
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).toBeNull();
    expect(screen.queryByText("Extract magic number")).toBeNull();
    unmount();

    renderPanel({ severities: ["CRITICAL", "WARNING"] });
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Extract magic number")).toBeNull();
  });

  it("reports the clicked severity up to the page", () => {
    const onToggleSeverity = vi.fn();
    renderPanel({ onToggleSeverity });
    fireEvent.click(chip("Warning"));
    expect(onToggleSeverity).toHaveBeenCalledWith("WARNING");
  });

  it("falls back to the empty state when this run has none of the selected level", () => {
    renderPanel({ findings: [finding({ id: "w1", severity: "WARNING" })], severities: ["CRITICAL"] });
    expect(screen.getByText("No findings match")).toBeInTheDocument();
    // The bar stays put so the filter can be cleared from here.
    expect(chip("Critical")).toHaveTextContent("0");
  });

  /**
   * The load-bearing rule: a chip's number is what you get by lighting it
   * alone. So "hide low confidence" moves the counts, and the severity
   * selection never does — otherwise the bar renumbers itself as you click it.
   */
  it("counts respect hide-low-confidence but not the severity selection", () => {
    const { unmount } = renderPanel({ severities: ["SUGGESTION"] });
    expect(chip("Critical")).toHaveTextContent("2");
    unmount();

    renderPanel();
    fireEvent.click(screen.getByRole("switch"));
    expect(chip("Critical")).toHaveTextContent("1");
    expect(screen.queryByText("Unsure critical")).toBeNull();
  });
});
