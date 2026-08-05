import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "test-coverage-nudge",
  description: "Use when a diff adds or changes tests.",
  type: "custom",
  source: "manual",
  body: "## Rubric",
  enabled: true,
  version: 1,
  evidence_files: null,
  used_by_count: 3,
  pull_rate: 0.71,
  accept_rate: 0.74,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders the name, type badge and description", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("test-coverage-nudge")).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();
    expect(screen.getByText("Use when a diff adds or changes tests.")).toBeInTheDocument();
  });

  it("falls back to a placeholder when the skill has no description", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("always states provenance, for every source", () => {
    // Where a body came from is what the user has to judge before enabling it, so
    // it is on the card unconditionally rather than only when it looks risky.
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url" }} />);
    expect(screen.getByText("Imported")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "community" }} />);
    expect(screen.getByText("Community")).toBeInTheDocument();
  });

  it("warns 'needs vetting' only for an imported skill that is still disabled", () => {
    // The source badge already states provenance, so the warning is reserved for
    // the state the import flow creates: someone else's instructions, not yet
    // vouched for by a human.
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does NOT warn once an imported skill has been enabled", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("does NOT warn for a hand-authored skill, even when disabled", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "manual", enabled: false }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("renders the usage footer", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("71% pull")).toBeInTheDocument();
    expect(screen.getByText("74% accept")).toBeInTheDocument();
  });

  it("renders an em dash — never 0% — for a rate with nothing to measure", () => {
    // null and 0 are different facts: a skill nobody has judged has no accept
    // rate, while one whose findings were all dismissed genuinely has 0%.
    renderWithIntl(<SkillCard skill={{ ...SKILL, pull_rate: null, accept_rate: null }} />);
    expect(screen.getByText("— pull")).toBeInTheDocument();
    expect(screen.getByText("— accept")).toBeInTheDocument();
    expect(screen.queryByText("0% accept")).not.toBeInTheDocument();
  });

  it("distinguishes a real 0% from an unknown rate", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, accept_rate: 0 }} />);
    expect(screen.getByText("0% accept")).toBeInTheDocument();
  });

  it("reports the new value when the enabled toggle is flipped", () => {
    const onToggle = vi.fn();
    const { container } = renderWithIntl(<SkillCard skill={SKILL} onToggle={onToggle} />);
    fireEvent.click(container.querySelectorAll("button")[0]!);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("does not fire onClick when the toggle is used", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    const { container } = renderWithIntl(
      <SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />,
    );
    fireEvent.click(container.querySelectorAll("button")[0]!);
    expect(onToggle).toHaveBeenCalled();
    // Toggling is not selecting — the click must not also open the detail.
    expect(onClick).not.toHaveBeenCalled();
  });
});
