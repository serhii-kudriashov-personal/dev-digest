/**
 * RepoIdentity — "which repository, on which forge", as text.
 * SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) — AC-31, AC-33.
 *
 * This is the component the repository card on `/` and the change-request list
 * screen both render, so the two surfaces are asserted here once rather than
 * twice through their own view shells.
 *
 * Every assertion is on text or on an accessible name. Nothing here looks at a
 * class or an icon, which is the acceptance criterion itself: a provider
 * distinction carried by a colour or a glyph is invisible to a screen reader and
 * to anyone who cannot tell the two logos apart.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
// Three `../` from src/components/repo-identity/ to the package root.
import messages from "../../../messages/en/common.json";
import { RepoIdentity, type RepoIdentityRepo } from "./RepoIdentity";
import { truncateNamespace } from "./helpers";

afterEach(cleanup);

/** A GitLab project nested four deep — the AC-33 case. */
const DEEP: RepoIdentityRepo = {
  provider: "gitlab",
  namespace_path: "acme-corp/platform/payments/api",
  instance_label: "Acme GitLab",
};

/** A GitHub repository, two segments, exactly as it was before this feature. */
const FLAT: RepoIdentityRepo = {
  provider: "github",
  namespace_path: "acme/payments-api",
  instance_label: "github.com",
};

function renderIdentity(repo: RepoIdentityRepo) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <RepoIdentity repo={repo} />
    </NextIntlClientProvider>,
  );
}

describe("RepoIdentity — instance as text (AC-31)", () => {
  it("names the GitLab instance the repository lives on", () => {
    renderIdentity(DEEP);
    expect(screen.getByText("on Acme GitLab")).toBeInTheDocument();
  });

  it("names github.com for a GitHub repository, so the built-in host is stated too", () => {
    renderIdentity(FLAT);
    expect(screen.getByText("on github.com")).toBeInTheDocument();
  });

  it("takes the instance from the repository, never from a default", () => {
    // Two repositories rendered from two different instances must read
    // differently. A hard-coded label would satisfy the two tests above.
    renderIdentity({ ...DEEP, instance_label: "Team GitLab" });
    expect(screen.getByText("on Team GitLab")).toBeInTheDocument();
    expect(screen.queryByText("on Acme GitLab")).not.toBeInTheDocument();
  });
});

describe("RepoIdentity — long namespace path (AC-33)", () => {
  it("truncates from the FRONT, keeping the project and its nearest groups", () => {
    renderIdentity(DEEP);
    // The tail distinguishes one project from another; the head is shared by
    // every project in the group. Dropping the tail would be the wrong end.
    expect(screen.getByText("…/platform/payments/api")).toBeInTheDocument();
    expect(screen.queryByText("acme-corp/platform/payments/api")).not.toBeInTheDocument();
  });

  it("offers the whole path on screen, named in the control's accessible name", () => {
    renderIdentity(DEEP);
    expect(
      screen.getByRole("button", { name: "Show the full path acme-corp/platform/payments/api" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals the whole path in place when the control is used", async () => {
    const user = userEvent.setup();
    renderIdentity(DEEP);

    await user.click(screen.getByRole("button", { name: /Show the full path/ }));

    expect(screen.getByText("acme-corp/platform/payments/api")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Shorten the path acme-corp/platform/payments/api" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves a two-segment GitHub path untouched, with no control to expand (AC-19)", () => {
    renderIdentity(FLAT);
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    // A control that reveals what is already visible is noise, not affordance.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("truncateNamespace", () => {
  it("keeps the last segments and reports that it truncated", () => {
    expect(truncateNamespace("a/b/c/d/e", 3)).toEqual({ shown: "c/d/e", truncated: true });
  });

  it("returns a short path unchanged and reports no truncation", () => {
    expect(truncateNamespace("acme/payments-api", 3)).toEqual({
      shown: "acme/payments-api",
      truncated: false,
    });
  });

  it("does not truncate a path of exactly the limit", () => {
    // The off-by-one that would put a `…/` in front of a path with nothing hidden.
    expect(truncateNamespace("a/b/c", 3)).toEqual({ shown: "a/b/c", truncated: false });
  });
});
