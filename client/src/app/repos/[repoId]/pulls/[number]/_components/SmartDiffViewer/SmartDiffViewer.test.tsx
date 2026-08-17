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
 *
 * `lineTarget` is a required prop as of L06: the card-open + scroll-to-line
 * orchestration moved into `components/diff-viewer` when the Blast Radius card
 * became its second consumer. The harness below calls the real hook, so these
 * tests still exercise the production behaviour rather than a fake.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiffGroup } from "@devdigest/shared";
import { fileHeadingId, useDiffLineTarget, type DiffCommentApi } from "@/components/diff-viewer";
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

type ViewerProps = Partial<Omit<React.ComponentProps<typeof SmartDiffViewer>, "lineTarget">>;

/** Owns the real `useDiffLineTarget` instance, the way `DiffTab` does. */
function Harness(props: ViewerProps) {
  const lineTarget = useDiffLineTarget();
  return (
    <SmartDiffViewer
      groups={groups()}
      files={FILES}
      findings={[]}
      {...props}
      lineTarget={lineTarget}
    />
  );
}

function renderViewer(props: ViewerProps = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, shell: shellMessages }}>
      <Harness {...props} />
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

  it("moves keyboard focus into the diff, onto the target file's heading, after a badge click", async () => {
    // Before this feature, focus stayed on the badge button — a keyboard user
    // tabbing on would continue from above the diff. Focus following the
    // programmatic scroll is the accessible behaviour.
    const user = userEvent.setup();
    const path = "pnpm-lock.yaml";
    renderViewer({
      groups: groups({ [path]: [2] }),
      findings: [finding({ file: path, start_line: 2 })],
    });

    await user.click(screen.getByRole("button", { name: /Go to the first of 1 findings/ }));

    expect(document.activeElement?.id).toBe(fileHeadingId(path));
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

  it("a severity chip on a flagged line reports THAT finding to the page", async () => {
    // The other half of the feature: the file-level badge moves the viewport
    // inside the diff, the per-line chip opens the finding's card in a new
    // browser tab (the page does the `window.open`, this component only reports
    // the click). Without this wire the chip is decoration and Smart Diff is a
    // view with no way into the findings it marks.
    const user = userEvent.setup();
    const path = "server/src/modules/billing/service.ts";
    const target = finding({ file: path, start_line: 2, title: "Unbounded request rate" });
    const onFindingClick = vi.fn();
    renderViewer({
      groups: groups({ [path]: [2] }),
      findings: [target],
      onFindingClick,
    });

    await user.click(screen.getByRole("button", { name: /Open the finding in a new tab: Unbounded request rate/ }));

    expect(onFindingClick).toHaveBeenCalledTimes(1);
    expect(onFindingClick).toHaveBeenCalledWith(target);
  });

  it("renders the chip as plain text when the page offers nowhere to go", () => {
    // `onFindingClick` is optional, and the overlay is read-only either way — so
    // omitting it must not leave a button that does nothing.
    const path = "server/src/modules/billing/service.ts";
    renderViewer({
      groups: groups({ [path]: [2] }),
      findings: [finding({ file: path, start_line: 2 })],
    });

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open the finding in a new tab:/ })).not.toBeInTheDocument();
  });

  it("before the first review: every group renders, with no badges and no chips", () => {
    renderViewer();

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to the first of/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });
});
