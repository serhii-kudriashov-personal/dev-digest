/**
 * The change-request list — SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`)
 * AC-44 and NFR-7, plus the AC-26/AC-27 vocabulary the whole screen is scoped by.
 *
 * NFR-7 is the reason this file exists: "the repository has no open change
 * requests", "the last sync with the instance failed, so this is a snapshot" and
 * "still loading" are THREE different facts, and a list that draws the same
 * empty table for all three tells the user the first one — which is a confident
 * falsehood in the other two cases. Each test below therefore asserts what the
 * state says AND that the other two states' text is absent.
 *
 * AppShell is mocked at the boundary (it pulls in the whole shell context); this
 * file is about the list's own three states, not the chrome around it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, Repo } from "@devdigest/shared";
// Seven `../` from src/app/repos/[repoId]/pulls/_components/PullsView/.
import messages from "../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../messages/en/common.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("status=all"),
}));

let pullsState: { data: PrMeta[] | undefined; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};

vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ ...pullsState, error: null, refetch: vi.fn() }),
  useRefreshRepo: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The row's findings cell fetches lazily; nothing under test here reads it.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: undefined, isLoading: false }),
}));

let activeRepo: Repo | null = null;

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo,
    repoId: "r1",
    setRepoId: vi.fn(),
    repos: activeRepo ? [activeRepo] : [],
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

import { PullsView } from "./PullsView";

const GITLAB_REPO: Repo = {
  id: "r1",
  workspace_id: "w1",
  owner: "payments",
  name: "api",
  full_name: "payments/api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
  provider: "gitlab",
  instance_id: "i1",
  namespace_path: "acme-corp/platform/payments/api",
  instance_label: "Acme GitLab",
  web_url: "https://gitlab.acme.dev/acme-corp/platform/payments/api",
  last_sync_error: null,
};

function pr(over: Partial<PrMeta> = {}): PrMeta {
  return {
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
    status: "needs_review",
    opened_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
    score: 61,
    cost_usd: 0.014,
    findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
    ...over,
  };
}

afterEach(() => {
  cleanup();
  pullsState = { data: [], isLoading: false, isError: false };
  activeRepo = null;
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, common: commonMessages }}>
      <PullsView />
    </NextIntlClientProvider>,
  );
}

/** The text unique to each of the three states, so each test can deny the others. */
const EMPTY_TITLE = "No merge requests";
const LOADING_TEXT = "Loading merge requests…";

describe("PullsView — three list states (AC-44, NFR-7)", () => {
  it("LOADING says so, and claims neither emptiness nor a failed sync", () => {
    activeRepo = GITLAB_REPO;
    pullsState = { data: undefined, isLoading: true, isError: false };
    renderView();

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("EMPTY states that the repository has none, and shows no failure", () => {
    activeRepo = GITLAB_REPO;
    pullsState = { data: [], isLoading: false, isError: false };
    renderView();

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(
        "No open merge requests found for this repository yet. Refresh to sync from Acme GitLab.",
      ),
    ).toBeInTheDocument();
    // No banner: nothing failed, the answer really is "none".
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
  });

  it("STALE names the instance and states the failure, over the last snapshot", () => {
    activeRepo = { ...GITLAB_REPO, last_sync_error: "401 Unauthorized: token rejected" };
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    const banner = screen.getByRole("status");
    // The instance is named — with two registered, "sync failed" alone does not
    // say which one to go and fix.
    expect(banner).toHaveTextContent("Acme GitLab");
    // The forge's own reason is shown as data, not swallowed into a generic
    // "something went wrong".
    expect(banner).toHaveTextContent("401 Unauthorized: token rejected");
    // …and the snapshot is still browsable, which is the whole degradation
    // promise: the row from the last successful sync is on screen.
    expect(screen.getByText("Add rate limiting to public API endpoints")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it("STALE and EMPTY are distinguishable when the snapshot itself is empty", () => {
    // The hardest of the three: no rows either way, so the ONLY difference is
    // whether the failure is stated.
    activeRepo = { ...GITLAB_REPO, last_sync_error: "getaddrinfo ENOTFOUND gitlab.acme.dev" };
    pullsState = { data: [], isLoading: false, isError: false };
    renderView();

    expect(screen.getByRole("status")).toHaveTextContent("getaddrinfo ENOTFOUND gitlab.acme.dev");
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
  });

  it("a successful sync leaves no failure banner behind", () => {
    activeRepo = GITLAB_REPO;
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("PullsView — vocabulary follows the owning repository (AC-26, AC-27)", () => {
  it("a GitLab repository's list is titled Merge Requests throughout", () => {
    activeRepo = GITLAB_REPO;
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    expect(screen.getByRole("heading", { name: "Merge Requests" })).toBeInTheDocument();
    expect(screen.getByText("Merge request")).toBeInTheDocument(); // column header
    expect(screen.getByText("!17")).toBeInTheDocument();
    expect(screen.queryByText("#17")).toBeNull();
  });

  it("a GitHub repository's list is unchanged from before the feature (AC-19, AC-27)", () => {
    activeRepo = {
      ...GITLAB_REPO,
      provider: "github",
      instance_label: "github.com",
      namespace_path: "acme/payments-api",
      web_url: "https://github.com/acme/payments-api",
    };
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    expect(screen.getByRole("heading", { name: "Pull Requests" })).toBeInTheDocument();
    expect(screen.getByText("#17")).toBeInTheDocument();
    expect(screen.queryByText("!17")).toBeNull();
  });

  it("uses the provider's own word in the filter placeholder", () => {
    // AC-26/AC-28: every provider-scoped string on this screen takes the
    // provider as an ICU argument, and each consumer has to SUPPLY it. A caller
    // that omits the argument does not throw and does not fail `tsc` — next-intl
    // logs an IntlError and renders its FALLBACK, which is the message key.
    //
    // FAILING ON PURPOSE, and not to be relaxed: `FilterBar.tsx:38` calls
    // `t("list.filterPlaceholder")` with no argument, and `FilterBar` is not
    // given the provider at all, so the search box currently renders
    // `placeholder="prReview.list.filterPlaceholder"` on BOTH providers. The fix
    // is in the component (thread the provider through, or make the string
    // neutral), which is not this file's to make.
    activeRepo = GITLAB_REPO;
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    expect(screen.getByPlaceholderText("Filter merge requests…")).toBeInTheDocument();
  });

  it("names the instance on the screen as text (AC-31)", () => {
    activeRepo = GITLAB_REPO;
    pullsState = { data: [pr()], isLoading: false, isError: false };
    renderView();

    // Once in the row, once beside the repository identity in the header.
    expect(screen.getAllByText("on Acme GitLab").length).toBeGreaterThanOrEqual(1);
  });
});
