/**
 * BlastRadiusCard — asserts what a reviewer sees and can do, never internal
 * state or CSS.
 *
 * Props-only, so there is no network here at all and no MSW (this repo does not
 * use it). Interactions go through `userEvent`, which simulates the full
 * pointer/focus sequence a real user produces.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import messages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

const DECL_A = "server/src/platform/limiter.ts";
const DECL_B = "server/src/platform/clock.ts";
/** In the PR's diff → an in-app button. */
const CALLER_IN_DIFF = "server/src/app.ts";
/** Outside the PR's diff → a GitHub link. */
const CALLER_OUTSIDE = "server/src/modules/pulls/routes.ts";

const REPO = "acme/dev-digest";
const SHA = "abc123";

const FULL: BlastRadiusResponse = {
  state: "full",
  changed_symbols: [
    { name: "rateLimit", file: DECL_A, kind: "function" },
    { name: "nowMs", file: DECL_B, kind: "function" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      file: DECL_A,
      callers: [
        { name: "buildApp", file: CALLER_IN_DIFF, line: 96 },
        { name: "pullsRoutes", file: CALLER_OUTSIDE, line: 49 },
      ],
      endpoints_affected: ["GET /pulls/:id"],
      crons_affected: ["job:poll_repos"],
    },
    {
      symbol: "nowMs",
      file: DECL_B,
      callers: [{ name: "pullsRoutes", file: CALLER_OUTSIDE, line: 7 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: "2 changed symbols reach 3 callers in 2 files; 1 HTTP endpoint and 1 cron may be affected.",
};

function renderCard(props: Partial<React.ComponentProps<typeof BlastRadiusCard>> = {}) {
  const onOpenCaller = props.onOpenCaller ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages, brief: briefMessages }}>
      <BlastRadiusCard
        blast={FULL}
        loading={false}
        changedPaths={new Set([DECL_A, DECL_B, CALLER_IN_DIFF])}
        repoFullName={REPO}
        headSha={SHA}
        {...props}
        onOpenCaller={onOpenCaller}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenCaller };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BlastRadiusCard", () => {
  it("renders the four counts, the callers, and navigates a caller inside the diff", async () => {
    const user = userEvent.setup();
    const { onOpenCaller } = renderCard();

    // The counts are derived from the response, not sent by it.
    for (const [value, label] of [
      ["2", "symbols"],
      ["3", "callers"],
      ["1", "endpoints"],
      ["1", "cron/jobs"],
    ] as const) {
      const labelNode = screen.getByText(label);
      expect(labelNode.previousSibling).toHaveTextContent(value);
    }

    // The server's deterministic summary is rendered as data.
    expect(screen.getByText(FULL.summary)).toBeInTheDocument();

    // A symbol with callers starts expanded, so its rows and facts are readable.
    expect(screen.getByText("GET /pulls/:id")).toBeInTheDocument();
    expect(screen.getByText("job:poll_repos")).toBeInTheDocument();
    // The caller-count badge for the second symbol.
    expect(screen.getByText("1 callers")).toBeInTheDocument();

    // A caller INSIDE the PR's diff is a button that hands (path, line) up.
    await user.click(
      screen.getByRole("button", {
        name: `Open ${CALLER_IN_DIFF} line 96 in the diff`,
      }),
    );
    expect(onOpenCaller).toHaveBeenCalledWith(CALLER_IN_DIFF, 96);
    expect(onOpenCaller).toHaveBeenCalledTimes(1);
  });

  it("renders a caller OUTSIDE the diff as a GitHub link and never calls onOpenCaller", async () => {
    const user = userEvent.setup();
    const { onOpenCaller } = renderCard();

    const link = screen.getByRole("link", {
      name: `Open ${CALLER_OUTSIDE} line 49 on GitHub`,
    });
    expect(link).toHaveAttribute("href", githubBlobUrl(REPO, SHA, CALLER_OUTSIDE, 49));
    expect(link).toHaveAttribute("target", "_blank");

    await user.click(link);
    expect(onOpenCaller).not.toHaveBeenCalled();
  });

  it("a symbol with zero callers is still listed, with a 0 badge", () => {
    renderCard({
      blast: {
        ...FULL,
        downstream: [
          ...FULL.downstream,
          {
            symbol: "unused",
            file: "server/src/platform/unused.ts",
            callers: [],
            endpoints_affected: [],
            crons_affected: [],
          },
        ],
      },
    });
    expect(screen.getByText("unused")).toBeInTheDocument();
    expect(screen.getByText("0 callers")).toBeInTheDocument();
  });

  it("a degraded response shows the state badge and the reason, and NO caller row", () => {
    renderCard({
      blast: {
        state: "degraded",
        reason: "no_rank_graph",
        changed_symbols: [],
        downstream: [],
        summary:
          "Blast radius unavailable: the index is incomplete and the import graph was never built.",
      },
    });

    expect(screen.getByText("Index unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The index is incomplete: the import graph was never built, so callers cannot be resolved.",
      ),
    ).toBeInTheDocument();
    // Degraded is NOT the empty state — the empty copy must not appear.
    expect(screen.queryByText("Nothing downstream")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a full response with no callers shows the empty state and NO badge", () => {
    renderCard({
      blast: {
        state: "full",
        changed_symbols: [],
        downstream: [],
        summary: "No code symbols changed in this PR.",
      },
    });

    expect(screen.getByText("Nothing downstream")).toBeInTheDocument();
    expect(
      screen.getByText("No callers were found for the symbols this PR changes."),
    ).toBeInTheDocument();
    // No state badge at all: 'full' is the healthy answer.
    expect(screen.queryByText("Index unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Partial index")).not.toBeInTheDocument();
  });

  it("the graph view is reachable and labelled, and its caller labels still navigate", async () => {
    const user = userEvent.setup();
    const { onOpenCaller } = renderCard();

    await user.click(screen.getByRole("button", { name: "graph" }));

    const graph = screen.getByRole("img", { name: "Blast radius graph" });
    expect(graph).toBeInTheDocument();
    // The tree's caller buttons are gone, so the two views do not both render.
    expect(
      screen.queryByRole("button", { name: `Open ${CALLER_IN_DIFF} line 96 in the diff` }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText(`${CALLER_IN_DIFF}:96`));
    expect(onOpenCaller).toHaveBeenCalledWith(CALLER_IN_DIFF, 96);
  });

  it("renders nothing while the query is loading", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ blast: messages, brief: briefMessages }}>
        <BlastRadiusCard
          blast={undefined}
          loading
          changedPaths={new Set()}
          repoFullName={null}
          headSha={null}
          onOpenCaller={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
