/**
 * SmartDiffViewer — the reviewer-ordered diff. Asserts what a reviewer sees and
 * can do, never internal state or CSS.
 *
 * Props-only, so there is no network here at all and no MSW (this repo does not
 * use it). Interactions go through `userEvent`, which simulates the full
 * pointer/focus sequence a real user produces.
 *
 * jsdom implements no layout, so `Element.prototype.scrollIntoView` DOES NOT
 * EXIST — the navigation test throws `not a function` without the stub below.
 * It is stubbed locally rather than in `src/test/setup.ts`: that is a shared
 * file and this is still the only consumer.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiffGroup } from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
import messages from "../../../../../../../../messages/en/brief.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

const CORE_BODY = "const rateLimiter = true;";
// No leading whitespace on purpose: `getByText` normalizes it away, so a body
// line that starts with spaces cannot be matched by its literal text.
const LOCK_BODY = "lodash: 4.17.21";
const BIG_CORE_BODY = "const table = buildTable();";

const FILES: PrFile[] = [
  {
    path: "server/src/modules/billing/service.ts",
    additions: 2,
    deletions: 0,
    patch: `@@ -1,1 +1,3 @@\n context();\n+${CORE_BODY}`,
  },
  {
    path: "server/src/modules/billing/index.ts",
    additions: 1,
    deletions: 0,
    patch: "@@ -1,1 +1,2 @@\n export {};\n+export * from './service';",
  },
  {
    path: "pnpm-lock.yaml",
    additions: 1,
    deletions: 0,
    patch: `@@ -1,1 +1,2 @@\n lockfileVersion: 9\n+${LOCK_BODY}`,
  },
];

const groups = (findingLines: Record<string, number[]> = {}): SmartDiffGroup[] =>
  [
    { role: "core" as const, paths: ["server/src/modules/billing/service.ts"] },
    { role: "wiring" as const, paths: ["server/src/modules/billing/index.ts"] },
    { role: "boilerplate" as const, paths: ["pnpm-lock.yaml"] },
  ].map(({ role, paths }) => ({
    role,
    files: paths.map((path) => {
      const file = FILES.find((f) => f.path === path)!;
      return {
        path,
        pseudocode_summary: null,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        finding_lines: findingLines[path] ?? [],
      };
    }),
  }));

const finding = (over: Partial<FindingRecord> & { file: string; start_line: number }): FindingRecord => ({
  id: `${over.file}:${over.start_line}`,
  severity: "CRITICAL",
  category: "security",
  title: "Unbounded request rate",
  end_line: over.start_line,
  rationale: "why",
  confidence: 1,
  review_id: "rev-1",
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, shell: shellMessages }}>
      <SmartDiffViewer groups={groups()} files={FILES} findings={[]} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SmartDiffViewer", () => {
  it("groups files core → wiring → boilerplate, expanding core and collapsing boilerplate", () => {
    renderViewer();

    const headings = screen.getAllByText(/^(Core|Wiring|Boilerplate)$/);
    expect(headings.map((h) => h.textContent)).toEqual(["Core", "Wiring", "Boilerplate"]);

    // One file per group, stated in the group header.
    expect(screen.getAllByText("1 files")).toHaveLength(3);

    // Core is open, so its diff body is readable …
    expect(screen.getByText(CORE_BODY)).toBeInTheDocument();
    // … and the lock file is collapsed, so its body is nowhere.
    expect(screen.queryByText(LOCK_BODY)).not.toBeInTheDocument();
  });

  it("a findings badge opens even a collapsed boilerplate file and scrolls to the line", async () => {
    const user = userEvent.setup();
    renderViewer({
      groups: groups({ "pnpm-lock.yaml": [2] }),
      findings: [finding({ file: "pnpm-lock.yaml", start_line: 2, title: "Pinned to a yanked release" })],
    });

    // Boilerplate starts collapsed even though it carries a finding.
    expect(screen.queryByText(LOCK_BODY)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Go to the first of 1 findings/ }));

    // The file is now open, the flagged line is rendered with its severity chip,
    // and the viewport was asked to move to it.
    expect(screen.getByText(LOCK_BODY)).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    // A SECOND click on the same badge scrolls again — the whole point of the
    // sequence number behind the navigation target.
    await user.click(screen.getByRole("button", { name: /Go to the first of 1 findings/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("counts one badge entry per distinct flagged line, and jumps to the first", async () => {
    const user = userEvent.setup();
    const path = "server/src/modules/billing/service.ts";
    renderViewer({
      groups: groups({ [path]: [1, 2] }),
      findings: [
        finding({ file: path, start_line: 1 }),
        finding({ file: path, start_line: 2 }),
      ],
    });

    // The label is the count the server computed — one entry per distinct
    // `start_line`, not one per finding row.
    const badge = screen.getByRole("button", { name: /Go to the first of 2 findings/ });
    expect(badge).toHaveTextContent("2 findings");

    await user.click(badge);

    // "First" means the lowest flagged line, and the scroll goes to THAT row.
    const scrolled = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock
      .contexts[0] as HTMLElement;
    expect(scrolled.id).toBe("diff-server-src-modules-billing-service-ts-L1");
  });

  it("leaves a big unflagged core file to the viewer's size heuristic, and opens it once flagged", () => {
    // `SmartDiffRow` passes `defaultOpen: undefined` for a core/wiring file with
    // no findings, so the shared FileCard's own auto-expand rule decides. This
    // pins the visible consequence of that deviation: past the threshold the
    // file is collapsed, and a finding — not its size — is what opens it.
    const bigCore: PrFile = {
      path: "server/src/modules/billing/table.ts",
      // Far past the diff-viewer's AUTO_EXPAND_MAX_LINES (200).
      additions: 400,
      deletions: 0,
      patch: `@@ -1,1 +1,3 @@\n context();\n+${BIG_CORE_BODY}`,
    };
    const withBigCore = (finding_lines: number[]): SmartDiffGroup[] => [
      {
        role: "core",
        files: [
          {
            path: bigCore.path,
            pseudocode_summary: null,
            additions: bigCore.additions ?? 0,
            deletions: bigCore.deletions ?? 0,
            finding_lines,
          },
        ],
      },
    ];

    const { unmount } = renderViewer({ groups: withBigCore([]), files: [bigCore], findings: [] });
    expect(screen.getByText(bigCore.path)).toBeInTheDocument();
    expect(screen.queryByText(BIG_CORE_BODY)).not.toBeInTheDocument();
    unmount();

    renderViewer({
      groups: withBigCore([2]),
      files: [bigCore],
      findings: [finding({ file: bigCore.path, start_line: 2 })],
    });
    expect(screen.getByText(BIG_CORE_BODY)).toBeInTheDocument();
  });

  it("still posts an inline comment in the smart order", async () => {
    // The other half of "commenting works in BOTH orders": here the card is
    // controlled (`open` / `onOpenChange`) and carries a findings overlay, so
    // the composer has to survive both.
    const user = userEvent.setup();
    const commenting: DiffCommentApi = {
      comments: [],
      canComment: true,
      showComments: true,
      posting: false,
      onSubmit: vi.fn().mockResolvedValue({}),
    };
    renderViewer({
      groups: groups({ "server/src/modules/billing/service.ts": [2] }),
      findings: [finding({ file: "server/src/modules/billing/service.ts", start_line: 2 })],
      commenting,
    });

    const line = screen.getByText(CORE_BODY);
    await user.hover(line);
    const add = screen.getByRole("button", { name: "Add a comment on this line" });
    // `fireEvent` for these two steps only: a user-event pointer move dispatches
    // `mouseout` with `relatedTarget: null`, which React reads as leaving the
    // row, so the hover-only "+" unmounts before the click lands. Same reason as
    // in `components/diff-viewer/DiffViewer/DiffViewer.test.tsx`.
    fireEvent.mouseOver(add, { relatedTarget: line });
    fireEvent.click(add);

    await user.type(screen.getByPlaceholderText(/Leave a comment/), "Bound it.");
    await user.click(screen.getByRole("button", { name: /Comment/ }));

    expect(commenting.onSubmit).toHaveBeenCalledWith({
      path: "server/src/modules/billing/service.ts",
      line: 2,
      side: "RIGHT",
      body: "Bound it.",
    });
  });

  it("before the first review: every group renders, with no badges and no chips", () => {
    renderViewer();

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to the first of/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });
});
