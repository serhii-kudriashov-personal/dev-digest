/**
 * DiffViewer — the ORIGINAL order, i.e. the way this module rendered before the
 * smart-diff overlay existed. `FileCard` gained four optional props
 * (`findings`, `defaultOpen`, `open`, `onOpenChange`) and `DiffViewer` passes
 * none of them, so this file is the regression net for every pre-existing
 * caller: what a reviewer sees, and inline commenting, must be unchanged when
 * the overlay is absent.
 *
 * Props-only — no network, no MSW (this repo does not use it). Interactions go
 * through `userEvent`, which produces the full pointer sequence; the "+"
 * affordance only exists while a row is hovered, which `fireEvent` cannot
 * reproduce faithfully.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, PrReviewComment } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import type { DiffCommentApi } from "../comments";
import shellMessages from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

// No leading whitespace in any asserted line: `getByText` normalizes runs of
// whitespace in the DOM but not in the needle, so an indented body line can
// never be matched by its literal text (client/INSIGHTS.md 2026-08-09).
const SMALL_BODY = "const rateLimiter = true;";
const BIG_BODY = "const generated = 1;";

const SMALL: PrFile = {
  path: "server/src/modules/billing/service.ts",
  additions: 2,
  deletions: 0,
  patch: `@@ -1,1 +1,3 @@\n context();\n+${SMALL_BODY}`,
};

/** Past `AUTO_EXPAND_MAX_LINES`, so the size heuristic must keep it closed. */
const BIG: PrFile = {
  path: "server/src/modules/billing/table.ts",
  additions: AUTO_EXPAND_MAX_LINES + 1,
  deletions: 0,
  patch: `@@ -1,1 +1,3 @@\n context();\n+${BIG_BODY}`,
};

const EXISTING_COMMENT: PrReviewComment = {
  id: 11,
  path: SMALL.path,
  line: 2,
  original_line: 2,
  side: "RIGHT",
  body: "This needs a bound.",
  user: "octocat",
  created_at: "2026-08-01T10:00:00.000Z",
  html_url: "https://github.test/c/11",
  in_reply_to_id: null,
  is_outdated: false,
};

function commentApi(over: Partial<DiffCommentApi> = {}): DiffCommentApi {
  return {
    comments: [EXISTING_COMMENT],
    canComment: true,
    showComments: true,
    posting: false,
    onSubmit: vi.fn().mockResolvedValue({}),
    ...over,
  };
}

function renderViewer(props: Partial<React.ComponentProps<typeof DiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <DiffViewer files={[SMALL, BIG]} {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("DiffViewer — the original order, with no overlay", () => {
  it("renders every file in the order given, expanding by size and nothing else", async () => {
    const user = userEvent.setup();
    renderViewer();

    // Both headers, in the order the PR listed them — no grouping, no re-sort.
    const paths = screen.getAllByText(/billing\/(service|table)\.ts/);
    expect(paths.map((p) => p.textContent)).toEqual([SMALL.path, BIG.path]);

    // The size heuristic is the ONLY rule here: small open, big collapsed.
    expect(screen.getByText(SMALL_BODY)).toBeInTheDocument();
    expect(screen.queryByText(BIG_BODY)).not.toBeInTheDocument();

    // …and it is still just a default — the header toggles it.
    await user.click(screen.getByText(BIG.path));
    expect(screen.getByText(BIG_BODY)).toBeInTheDocument();
  });

  it("shows no finding chip anywhere when no findings overlay is passed", () => {
    renderViewer();
    // The overlay is opt-in; a caller that never heard of it must see the diff
    // it saw before, with no severity chip and no tinted line.
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
    expect(screen.queryByText("Warning")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggestion")).not.toBeInTheDocument();
  });

  it("still posts an inline comment: hover a line, open the composer, submit", async () => {
    const user = userEvent.setup();
    const commenting = commentApi();
    renderViewer({ commenting });

    // An existing thread renders inline on its line.
    expect(screen.getByText(EXISTING_COMMENT.body)).toBeInTheDocument();

    // The "+" exists only while the row is hovered.
    expect(
      screen.queryByRole("button", { name: "Add a comment on this line" }),
    ).not.toBeInTheDocument();
    const line = screen.getByText(SMALL_BODY);
    await user.hover(line);
    const add = screen.getByRole("button", { name: "Add a comment on this line" });

    // `fireEvent` for exactly these two steps, on purpose. Every user-event API
    // call re-enters the pointer at the new target, dispatching `mouseout` on
    // the old one with `relatedTarget: null`; React reads that as the pointer
    // leaving the ROW, so the hover-only "+" unmounts before the click can land
    // and `user.click(add)` silently does nothing. A real pointer stays inside
    // the row, so this is a jsdom/user-event artifact, not product behaviour.
    fireEvent.mouseOver(add, { relatedTarget: line });
    fireEvent.click(add);

    // The composer does not depend on hover, so user-event drives it from here.
    await user.type(screen.getByPlaceholderText(/Leave a comment/), "Bound it.");
    await user.click(screen.getByRole("button", { name: /Comment/ }));

    // The added line is new-side line 2 of this patch.
    expect(commenting.onSubmit).toHaveBeenCalledWith({
      path: SMALL.path,
      line: 2,
      side: "RIGHT",
      body: "Bound it.",
    });
  });
});
