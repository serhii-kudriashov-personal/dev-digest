/* Render guard for the skill editor's Context tab (SPEC-01) — the twin of the
   agent editor's, and kept in the same shape deliberately: see ContextTab.tsx's
   header comment for why the two are not merged. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
// Six `../`: src/app/skills/[id]/_components/ContextTab.
import messages from "../../../../../../messages/en/context.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo1", activeRepo: { full_name: "acme/payments-api" } }),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextListing: () => ({
    data: {
      state: "ok",
      documents: [
        { path: "docs/architecture.md", dir: "docs", root: "docs", est_tokens: 317 },
      ],
      scanned_at: "2026-08-16T00:00:00.000Z",
      truncated: false,
    },
  }),
  useSkillContextDocs: () => ({ data: [], isLoading: false }),
  useSetSkillContextDocs: () => ({ mutate: vi.fn(), isPending: false }),
  // DocumentPreview (client/src/components/document-preview) reads this hook
  // directly — it is the same hook the standalone Project Context page uses.
  useContextDoc: () => ({
    data: { path: "docs/architecture.md", content: "# Architecture", truncated: false },
    isLoading: false,
    isError: false,
  }),
}));

import { ContextTab } from "./ContextTab";

afterEach(cleanup);

describe("Skill Context tab (SPEC-01)", () => {
  it("renders without throwing, and shows the discovered document", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="sk1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
  });

  it("prints the untrusted wrapper verbatim (AC-28)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="sk1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('<untrusted source="spec-N">')).toBeInTheDocument();
    expect(screen.getByText("## Project context")).toBeInTheDocument();
  });

  it("opens the read-only preview panel on Preview and closes it on the X (AC-12)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="sk1" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Architecture")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();
  });
});
