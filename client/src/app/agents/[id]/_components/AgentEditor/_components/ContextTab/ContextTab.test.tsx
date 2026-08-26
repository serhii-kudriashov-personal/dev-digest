/* Render guard for the Context tab (SPEC-01).

   This exists because the tab shipped three times without ever rendering: no
   `NAV` row, then a `?tab=` allowlist that rejected `context`, then a crash on
   `t("serialization.wrapper")` — and the suite stayed green through all three,
   because nothing mounted the component. The point of this file is that
   something does. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
// Eight `../`: src/app/agents/[id]/_components/AgentEditor/_components/ContextTab.
import messages from "../../../../../../../../messages/en/context.json";

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
  useAgentContextDocs: () => ({ data: [], isLoading: false }),
  useSetAgentContextDocs: () => ({ mutate: vi.fn(), isPending: false }),
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

describe("Agent Context tab (SPEC-01)", () => {
  it("renders without throwing, and shows the discovered document", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="ag1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
  });

  it("prints the untrusted wrapper verbatim (AC-28)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="ag1" />
      </NextIntlClientProvider>,
    );
    // `t()` parses this as a rich-text tag and throws INVALID_TAG; only
    // `t.raw` renders it. Assert the literal, so a regression to `t()` fails
    // here rather than in the browser.
    expect(screen.getByText('<untrusted source="spec-N">')).toBeInTheDocument();
    expect(screen.getByText("## Project context")).toBeInTheDocument();
  });

  it("opens the read-only preview panel on Preview and closes it on the X (AC-12)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="ag1" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Architecture")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();
  });
});
