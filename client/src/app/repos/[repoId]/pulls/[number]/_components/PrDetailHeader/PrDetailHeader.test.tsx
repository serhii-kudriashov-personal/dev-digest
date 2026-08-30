/**
 * The change-request detail header — SPEC-06
 * (`specs/2026-08-28-gitlab-repositories.md`) AC-25, AC-26, AC-27, AC-31.
 *
 * Two obligations meet in this one component:
 * - it NAMES the change request (`!17` on GitLab, `#17` on GitHub) and the host
 *   it came from, as text rather than as an icon or a colour;
 * - it owns the only "open this on the forge" action in the app, and that action
 *   must be absent — not present-and-disabled — when the target failed the
 *   origin check. `forgeUrl` arrives here already admitted by
 *   `safeExternalHref`, so `null` is exactly "the target was rejected".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrDetail } from "@devdigest/shared";
// Eight `../` from …/pulls/[number]/_components/PrDetailHeader/.
import messages from "../../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../../messages/en/common.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/multi-agent", () => ({
  useStartMultiAgentRun: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PrDetailHeader } from "./PrDetailHeader";

afterEach(cleanup);

const PR: PrDetail = {
  id: "p1",
  number: 17,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "deadbeef",
  additions: 12,
  deletions: 3,
  files_count: 2,
  status: "open",
  opened_at: "2026-08-13T00:00:00Z",
  updated_at: "2026-08-13T00:00:00Z",
  score: 61,
  cost_usd: 0.014,
  findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
  body: null,
  files: [],
  commits: [],
  linked_issue: null,
};

function renderHeader(props: Partial<React.ComponentProps<typeof PrDetailHeader>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, common: commonMessages }}>
      <PrDetailHeader
        pr={PR}
        prId="p1"
        tab="overview"
        findingsCount={1}
        onSetTab={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrDetailHeader — naming the change request (AC-26, AC-27, AC-31)", () => {
  it("prefixes a GitLab merge request with ! and names its instance", () => {
    renderHeader({ provider: "gitlab", instanceLabel: "Acme GitLab" });

    expect(screen.getByText("!17")).toBeInTheDocument();
    expect(screen.getByText("on Acme GitLab")).toBeInTheDocument();
    expect(screen.queryByText("#17")).toBeNull();
  });

  it("keeps the GitHub form for a GitHub pull request (AC-19, AC-27)", () => {
    renderHeader({ provider: "github", instanceLabel: "github.com" });

    expect(screen.getByText("#17")).toBeInTheDocument();
    expect(screen.getByText("on github.com")).toBeInTheDocument();
  });

  it("defaults to the GitHub form before the repository resolves", () => {
    renderHeader();
    expect(screen.getByText("#17")).toBeInTheDocument();
  });

  it("names the merge request as a merge request in the merged banner", () => {
    renderHeader({
      pr: { ...PR, status: "merged" },
      provider: "gitlab",
      instanceLabel: "Acme GitLab",
    });

    expect(
      screen.getByText(
        "This merge request is already merged — running a review is informational and won’t affect the merged code.",
      ),
    ).toBeInTheDocument();
  });
});

describe("PrDetailHeader — the open-on-forge action (AC-25, AC-31)", () => {
  it("carries the instance inside the action's accessible name", () => {
    renderHeader({
      provider: "gitlab",
      instanceLabel: "Acme GitLab",
      forgeUrl: "https://gitlab.acme.dev/acme-corp/platform/payments/api/-/merge_requests/17",
    });

    expect(screen.getByRole("button", { name: "View on Acme GitLab" })).toBeInTheDocument();
  });

  it("renders NO clickable element when the target was rejected", () => {
    // `forgeUrl: null` is what `safeExternalHref` returns for an off-origin or
    // non-https target. The action must be gone, not greyed out: a disabled
    // control claims the link exists and is temporarily unavailable, which is a
    // different — and false — statement.
    renderHeader({ provider: "gitlab", instanceLabel: "Acme GitLab", forgeUrl: null });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /View on/ })).toBeNull();
  });

  it("renders no clickable element while the repository is still loading", () => {
    renderHeader({ provider: "gitlab", instanceLabel: "Acme GitLab" });

    expect(screen.queryByRole("button", { name: /View on/ })).toBeNull();
  });
});
