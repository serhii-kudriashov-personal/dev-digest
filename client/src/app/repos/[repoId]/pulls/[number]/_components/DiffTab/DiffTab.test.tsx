/**
 * DiffTab — the `?goto=<path>:<line>` cross-tab handoff from the Blast Radius
 * card. Asserts WHICH element scrolled, not just that something did.
 *
 * jsdom implements no layout, so `Element.prototype.scrollIntoView` DOES NOT
 * EXIST — this test throws `not a function` without the stub below. It is
 * stubbed locally rather than in `src/test/setup.ts`, matching
 * `SmartDiffViewer.test.tsx`.
 *
 * The data hooks are mocked out rather than served over the network: this repo
 * does not use MSW, and the tab's own queries are not what is under test.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import { fileHeadingId, lineAnchorId } from "@/components/diff-viewer";
import messages from "../../../../../../../../messages/en/brief.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: [] }),
}));

// No smart-diff response, so the tab renders the plain `DiffViewer` — the branch
// that has to honour `lineTarget` too, and the one that needs no fixture.
vi.mock("../../../../../../../lib/hooks/smart-diff", () => ({
  useSmartDiff: () => ({ data: undefined }),
}));

import { DiffTab } from "./DiffTab";

const PATH = "server/src/a.ts";
const BODY = "const answer = 42;";

const FILES: PrFile[] = [
  {
    path: PATH,
    additions: 2,
    deletions: 0,
    // Lines 1..3 on the new side; line 2 is `BODY`.
    patch: `@@ -1,1 +1,3 @@\n before();\n+${BODY}\n+after();`,
  },
];

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const onGotoConsumed = props.onGotoConsumed ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, shell: shellMessages }}>
      <DiffTab
        prId="pr-1"
        filesCount={FILES.length}
        files={FILES}
        {...props}
        onGotoConsumed={onGotoConsumed}
      />
    </NextIntlClientProvider>,
  );
  return { onGotoConsumed };
}

const scrolledElement = () =>
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock
    .contexts[0] as HTMLElement;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DiffTab — the ?goto= handoff", () => {
  it("scrolls to the element whose id is lineAnchorId(path, line) and clears the param", () => {
    const { onGotoConsumed } = renderTab({ goto: `${PATH}:2` });

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    // `toHaveBeenCalled` alone would pass on a scroll to the WRONG line, which is
    // exactly the bug this feature can have.
    expect(scrolledElement().id).toBe(lineAnchorId(PATH, 2));
    expect(onGotoConsumed).toHaveBeenCalledTimes(1);
  });

  it("moves keyboard focus to the target file's heading — a URL-driven navigation must not strand focus in the document body", () => {
    renderTab({ goto: `${PATH}:2` });

    expect(document.activeElement?.id).toBe(fileHeadingId(PATH));
  });

  it("opens the file's card, so the target line is actually rendered", () => {
    renderTab({ goto: `${PATH}:2` });
    expect(screen.getByText(BODY)).toBeInTheDocument();
  });

  it("ignores a goto whose path is not in this PR's files — there is no card to open", () => {
    const { onGotoConsumed } = renderTab({ goto: "server/src/elsewhere.ts:5" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(onGotoConsumed).not.toHaveBeenCalled();
  });

  it("ignores a malformed goto (no colon, or a non-numeric line)", () => {
    const { onGotoConsumed } = renderTab({ goto: PATH });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(onGotoConsumed).not.toHaveBeenCalled();
    cleanup();

    renderTab({ goto: `${PATH}:not-a-line` });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when no goto is present", () => {
    renderTab();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
