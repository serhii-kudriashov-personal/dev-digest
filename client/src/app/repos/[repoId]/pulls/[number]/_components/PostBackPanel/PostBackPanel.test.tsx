/**
 * PostBackPanel — SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`)
 * AC-38, AC-39, AC-40, AC-41, NFR-3, NFR-12.
 *
 * Five regression classes this file exists to catch:
 *
 * - **Two "posted" states collapsed into one** (AC-39). `posted_verdict_applied`
 *   and `posted_verdict_not_applied` are both posts that worked; they differ only
 *   in whether the verdict took effect. A test that asserts "a label appeared"
 *   still passes once someone merges them, so every state assertion here pins the
 *   exact wording AND asserts the sibling state's wording is absent.
 * - **`partially_published` read as a failure** (AC-40). Some notes are already
 *   sitting on the change request; a user told "failed" never goes to look at
 *   them.
 * - **The server's reason paraphrased into a capability claim** (AC-38, AC-41).
 *   GitLab approvals are a free-tier feature, so a refused approval means "this
 *   credential's user is not an eligible approver", never "this instance cannot
 *   approve" (root `INSIGHTS.md` 2026-08-28). The panel must render the server's
 *   sentence verbatim and invent nothing.
 * - **A second post duplicating notes on a real merge request.** The control is
 *   available for `not_posted` and for a run that was never posted — and for
 *   nothing else.
 * - **A raw message key rendered to the user.** next-intl fails soft: a missing
 *   ICU argument renders the key itself while `tsc`, `eslint` and every gate stay
 *   green (`client/INSIGHTS.md` 2026-08-29). That already shipped once in this
 *   feature, so every rendered state is swept for `postBack.`.
 *
 * Depth note: `messages/` is `../` × 8 from here (`client/INSIGHTS.md`
 * 2026-08-02), same as `ReviewRunAccordion/`.
 *
 * The panel is rendered DIRECTLY, never through `ReviewRunAccordion`: that file's
 * `vi.mock` of `lib/hooks/reviews` returns a two-hook factory, so opening the
 * accordion body there would make this component's hooks `undefined`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PostBackOutcome, ReviewPostBack } from "@devdigest/shared";
import type { RepoProvider } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";

/** What the fake `GET /pulls/:id/post-review/:runId` answers. */
let outcomeState: { data: ReviewPostBack | null | undefined; isLoading: boolean } = {
  data: null,
  isLoading: false,
};
const postMutate = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePostBackOutcome: () => outcomeState,
  usePostReview: () => ({ mutate: postMutate, isPending: false }),
}));

import { PostBackPanel } from "./PostBackPanel";

function postBack(over: Partial<ReviewPostBack> = {}): ReviewPostBack {
  return {
    run_id: "run-1",
    pr_id: "p1",
    outcome: "posted_verdict_applied",
    reason: null,
    notes_published: 3,
    created_at: "2026-08-29T09:15:00.000Z",
    ...over,
  };
}

function renderPanel(provider: RepoProvider = "gitlab") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PostBackPanel prId="p1" runId="run-1" provider={provider} />
    </NextIntlClientProvider>,
  );
}

/**
 * Three sentences composed by the server, quoted here EXACTLY as a server would
 * send them. The assertions match these strings character for character, so any
 * client-side rewording — a summary, a truncation, a capability claim
 * substituted for the stated reason — fails.
 */
const REFUSED_APPROVAL_REASON =
  "The notes were published. The approval was refused: the credential's user is not an eligible approver for this merge request.";
const REQUEST_CHANGES_REASON =
  "GitLab carries the verdict in the summary note rather than as a review state, so this request_changes run was posted as a note and no review state was set.";
const NOTE_CAP_REASON =
  "Only the first 25 of 41 inline notes were published; the rest were left off this post.";

afterEach(() => {
  cleanup();
  outcomeState = { data: null, isLoading: false };
  postMutate.mockReset();
});

describe("PostBackPanel — AC-39, four contract states as three user-facing outcomes", () => {
  it("says the verdict was applied, and does not read as the not-applied state", () => {
    outcomeState = { data: postBack({ outcome: "posted_verdict_applied" }), isLoading: false };
    renderPanel();

    expect(screen.getByText("Posted, and the verdict was applied")).toBeInTheDocument();
    // The distinction AC-39 exists for: a build that collapses the two "posted"
    // states passes a bare "something was posted" assertion.
    expect(screen.queryByText("Posted, but the verdict was not applied")).not.toBeInTheDocument();
  });

  it("says the verdict was NOT applied, and does not read as the applied state", () => {
    outcomeState = { data: postBack({ outcome: "posted_verdict_not_applied" }), isLoading: false };
    renderPanel();

    expect(screen.getByText("Posted, but the verdict was not applied")).toBeInTheDocument();
    expect(screen.queryByText("Posted, and the verdict was applied")).not.toBeInTheDocument();
  });

  it("reports a partial publication as notes already landed, never as a plain failure (AC-40)", () => {
    outcomeState = { data: postBack({ outcome: "partially_published" }), isLoading: false };
    renderPanel();

    // The wording has to send the user to the merge request, where half a review
    // is sitting.
    expect(
      screen.getByText("Partially published — some notes are already on the merge request"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing reached/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^failed/i)).not.toBeInTheDocument();
  });

  it("reports the ordinary failure as nothing having reached the change request", () => {
    outcomeState = { data: postBack({ outcome: "not_posted" }), isLoading: false };
    renderPanel();

    expect(
      screen.getByText("Not posted — nothing reached the merge request"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already on the merge request/i)).not.toBeInTheDocument();
  });

  it("states that a run was never posted when the server has no record of one", () => {
    outcomeState = { data: null, isLoading: false };
    renderPanel();

    expect(
      screen.getByText("This run has not been posted to the merge request."),
    ).toBeInTheDocument();
  });
});

describe("PostBackPanel — the server's reason, verbatim (AC-38, AC-41)", () => {
  it("quotes the refused-approval reason and claims nothing about the instance", () => {
    outcomeState = {
      data: postBack({
        outcome: "posted_verdict_not_applied",
        reason: REFUSED_APPROVAL_REASON,
      }),
      isLoading: false,
    };
    renderPanel();

    expect(screen.getByText(REFUSED_APPROVAL_REASON)).toBeInTheDocument();
    expect(screen.getByText("Posted, but the verdict was not applied")).toBeInTheDocument();
    // Approvals are free-tier on GitLab, so eligibility and capability are
    // different claims and only the server may make either (root `INSIGHTS.md`
    // 2026-08-28).
    expect(screen.queryByText(/cannot approve/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not licensed|unavailable|unsupported/i)).not.toBeInTheDocument();
  });

  it("quotes the request_changes downgrade sentence exactly as the server wrote it", () => {
    outcomeState = {
      data: postBack({
        outcome: "posted_verdict_not_applied",
        reason: REQUEST_CHANGES_REASON,
      }),
      isLoading: false,
    };
    renderPanel();

    expect(screen.getByText(REQUEST_CHANGES_REASON)).toBeInTheDocument();
  });
});

describe("PostBackPanel — the note count (NFR-3)", () => {
  it.each([
    [0, "No notes published"],
    [1, "1 note published"],
    [25, "25 notes published"],
  ])("renders %i published notes as %s", (count, expected) => {
    outcomeState = {
      data: postBack({ outcome: "partially_published", notes_published: count }),
      isLoading: false,
    };
    renderPanel();

    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it("repeats the server's truncation notice beside the capped count", () => {
    outcomeState = {
      data: postBack({
        outcome: "posted_verdict_applied",
        notes_published: 25,
        reason: NOTE_CAP_REASON,
      }),
      isLoading: false,
    };
    renderPanel();

    expect(screen.getByText(/25 notes published/)).toBeInTheDocument();
    expect(screen.getByText(NOTE_CAP_REASON)).toBeInTheDocument();
  });
});

describe("PostBackPanel — the outcome is read back from the server (NFR-12)", () => {
  it("renders a recorded outcome on a fresh mount, with no post having been fired", () => {
    // Exactly the state after a reload: the query answers, the mutation has
    // never run in this test. An outcome held only in the mutation's result
    // would render nothing here.
    outcomeState = {
      data: postBack({
        outcome: "posted_verdict_not_applied",
        reason: REFUSED_APPROVAL_REASON,
        notes_published: 4,
      }),
      isLoading: false,
    };
    renderPanel();

    expect(screen.getByText("Posted, but the verdict was not applied")).toBeInTheDocument();
    expect(screen.getByText(REFUSED_APPROVAL_REASON)).toBeInTheDocument();
    expect(screen.getByText(/4 notes published/)).toBeInTheDocument();
    expect(postMutate).not.toHaveBeenCalled();
  });
});

describe("PostBackPanel — the post control's guard", () => {
  it.each([
    ["gitlab" as const, "Post to merge request"],
    ["github" as const, "Post to pull request"],
  ])("offers %s the control while nothing has been posted, and posts this run", async (provider, name) => {
    const user = userEvent.setup();
    outcomeState = { data: null, isLoading: false };
    renderPanel(provider);

    await user.click(screen.getByRole("button", { name }));

    expect(postMutate).toHaveBeenCalledTimes(1);
    expect(postMutate).toHaveBeenCalledWith("run-1");
  });

  it("offers a retry after a post where nothing landed", () => {
    outcomeState = { data: postBack({ outcome: "not_posted" }), isLoading: false };
    renderPanel();

    expect(screen.getByRole("button", { name: "Try posting again" })).toBeInTheDocument();
  });

  it.each<PostBackOutcome>([
    "posted_verdict_applied",
    "posted_verdict_not_applied",
    "partially_published",
  ])("withdraws the control entirely for %s, so notes cannot be duplicated", (outcome) => {
    outcomeState = { data: postBack({ outcome }), isLoading: false };
    renderPanel();

    // Not merely disabled: absent. A disabled control that re-enables on the
    // next render is still a second post onto a real merge request.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PostBackPanel — no message key reaches the user", () => {
  it.each<[string, ReviewPostBack | null, RepoProvider]>([
    ["never posted", null, "gitlab"],
    ["never posted, github", null, "github"],
    ["posted_verdict_applied", postBack({ outcome: "posted_verdict_applied" }), "gitlab"],
    [
      "posted_verdict_not_applied",
      postBack({ outcome: "posted_verdict_not_applied", reason: REFUSED_APPROVAL_REASON }),
      "gitlab",
    ],
    ["partially_published", postBack({ outcome: "partially_published" }), "gitlab"],
    ["not_posted", postBack({ outcome: "not_posted" }), "github"],
  ])("renders no raw key in the %s state", (_label, data, provider) => {
    outcomeState = { data, isLoading: false };
    renderPanel(provider);

    // The serialized DOM rather than a text query on purpose: next-intl's
    // fallback puts the key wherever the message was used, including an
    // attribute such as `placeholder` or `aria-label`, which no text query sees
    // (`client/INSIGHTS.md` 2026-08-29).
    expect(document.body.innerHTML).not.toContain("postBack.");
    expect(document.body.innerHTML).not.toContain("prReview.");
  });
});
