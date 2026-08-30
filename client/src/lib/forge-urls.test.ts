/**
 * Provider-aware deep links (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`,
 * AC-25, AC-29, AC-30).
 *
 * Why this file asserts literal strings rather than "contains the sha": every
 * bug this module can have is a bug in the exact bytes. A link that is one
 * character wrong does not throw, does not fail a typecheck and does not fail
 * `pnpm lint` — it opens in the user's browser at the wrong line, or on the
 * wrong host. Root `INSIGHTS.md` 2026-08-28 records that no gate in this repo
 * can see the `#L1-2` vs `#L1-L2` difference, which makes these assertions the
 * only thing standing between it and a silently wrong link.
 *
 * `conventionEvidenceUrl`'s GitHub cases live in `ConventionCard.test.tsx`,
 * where they were written; this file covers what the GitLab side of the same
 * helper does differently.
 */
import { describe, it, expect } from "vitest";
import {
  blobUrl,
  changeRequestUrl,
  conventionEvidenceUrl,
  safeExternalHref,
  type ForgeRepoRef,
} from "./forge-urls";
import type { ConventionCandidate } from "@devdigest/shared";

/** github.com, exactly as a pre-feature workspace has it (AC-19, AC-27). */
const GITHUB: ForgeRepoRef = {
  provider: "github",
  web_url: "https://github.com/acme/payments-api",
  instance_label: "github.com",
};

/**
 * A self-managed GitLab that exercises every part of AC-29 at once: a
 * non-default port, a path prefix the instance is served under, and a namespace
 * nested deeper than `owner/repo`. Nothing here can be reconstructed from a
 * constant — which is the point of the acceptance criterion.
 */
const GITLAB: ForgeRepoRef = {
  provider: "gitlab",
  web_url: "https://gitlab.acme.dev:8443/gitlab/platform/payments/api",
  instance_label: "Acme GitLab",
};

describe("changeRequestUrl (AC-29)", () => {
  it("uses GitHub's pull-request path", () => {
    expect(changeRequestUrl(GITHUB, 482)).toBe(
      "https://github.com/acme/payments-api/pull/482",
    );
  });

  it("uses GitLab's merge-request path, under the instance's own port and prefix", () => {
    expect(changeRequestUrl(GITLAB, 17)).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/merge_requests/17",
    );
  });

  it("is built from the repository's web_url, never from a hard-coded host", () => {
    // Two repositories on two different self-managed instances must not produce
    // the same host. A builder that fell back to a constant would.
    const other: ForgeRepoRef = {
      ...GITLAB,
      web_url: "https://git.other-company.example/team/service",
    };
    expect(changeRequestUrl(other, 17)).toBe(
      "https://git.other-company.example/team/service/-/merge_requests/17",
    );
    expect(changeRequestUrl(other, 17)).not.toContain("gitlab.acme.dev");
    expect(changeRequestUrl(GITHUB, 17)).not.toContain("gitlab");
  });

  it("does not double a slash when web_url has a trailing one", () => {
    expect(changeRequestUrl({ ...GITHUB, web_url: "https://github.com/acme/api/" }, 3)).toBe(
      "https://github.com/acme/api/pull/3",
    );
  });
});

describe("blobUrl line anchors (AC-30)", () => {
  // The one-character case. Asserted literally on both sides, because the
  // GitLab form omits the repeated `L` and the two are otherwise identical.
  it("writes #L1-2 for a two-line range on GitLab", () => {
    expect(blobUrl(GITLAB, "abc123", "src/api/users.ts", 1, 2)).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/blob/abc123/src/api/users.ts#L1-2",
    );
  });

  it("writes #L1-L2 for the same range on GitHub", () => {
    expect(blobUrl(GITHUB, "abc123", "src/api/users.ts", 1, 2)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L1-L2",
    );
  });

  it("writes #L1 on both providers when there is no end line", () => {
    expect(blobUrl(GITLAB, "abc123", "src/api/users.ts", 1)).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/blob/abc123/src/api/users.ts#L1",
    );
    expect(blobUrl(GITHUB, "abc123", "src/api/users.ts", 1)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L1",
    );
  });

  it("collapses a range whose end equals its start to #L1 on both providers", () => {
    // Asserted on the fragment, not with `not.toContain("-")`: a GitLab blob
    // path legitimately contains `/-/`.
    expect(blobUrl(GITLAB, "abc123", "src/api/users.ts", 1, 1)).toMatch(/#L1$/);
    expect(blobUrl(GITHUB, "abc123", "src/api/users.ts", 1, 1)).toMatch(/#L1$/);
  });

  it("omits the fragment entirely when no line was given", () => {
    expect(blobUrl(GITHUB, "abc123", "src/api/users.ts")).not.toContain("#");
  });
});

describe("blobUrl paths", () => {
  it("puts a GitLab blob under /-/blob/ and a GitHub blob under /blob/", () => {
    expect(blobUrl(GITLAB, "abc123", "README.md")).toContain("/api/-/blob/abc123/README.md");
    expect(blobUrl(GITHUB, "abc123", "README.md")).toContain(
      "/acme/payments-api/blob/abc123/README.md",
    );
  });

  it("encodes each path segment but keeps the separators", () => {
    // A `/` encoded to %2F would flatten the path into one segment and 404.
    expect(blobUrl(GITHUB, "abc123", "src/api/user profile+v2.ts")).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/api/user%20profile%2Bv2.ts",
    );
  });

  it("keeps a deeply nested GitLab namespace intact in the URL", () => {
    // AC-13/NFR-4: a namespace nests arbitrarily. It is part of `web_url`, so
    // the builder must not assume the two-segment `owner/repo` shape.
    expect(blobUrl(GITLAB, "abc123", "docs/adr/0001.md")).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/blob/abc123/docs/adr/0001.md",
    );
  });
});

describe("conventionEvidenceUrl on GitLab", () => {
  const CANDIDATE: ConventionCandidate = {
    id: "cv1",
    rule: "Always use async/await instead of .then() chains.",
    category: "structure",
    evidence_path: "src/api/users.ts",
    evidence_snippet: "const user = await db.users.find(id);",
    evidence_line_start: 23,
    evidence_line_end: 31,
    confidence: 0.91,
    status: "pending",
    created_at: "2026-08-05T10:00:00.000Z",
  };
  const repo = { ...GITLAB, default_branch: "main" };

  it("anchors a range in GitLab's own form, pinned to the default branch", () => {
    expect(conventionEvidenceUrl(CANDIDATE, repo)).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/blob/main/src/api/users.ts#L23-31",
    );
  });

  it("links the file rather than #L0 when the gate computed no range", () => {
    // 0 is how "no range" is stored. `#L0` is a fragment no forge resolves, so
    // the link would silently land at the top of the file with a broken anchor.
    expect(
      conventionEvidenceUrl({ ...CANDIDATE, evidence_line_start: 0, evidence_line_end: 0 }, repo),
    ).toBe(
      "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/blob/main/src/api/users.ts",
    );
  });

  it("returns null with no repository, so nothing renders a dead link", () => {
    expect(conventionEvidenceUrl(CANDIDATE, null)).toBeNull();
  });
});

describe("safeExternalHref (AC-25)", () => {
  it("admits an https target on the repository's own origin", () => {
    const target = "https://gitlab.acme.dev:8443/gitlab/platform/payments/api/-/merge_requests/17";
    expect(safeExternalHref(target, GITLAB)).toBe(target);
  });

  it("rejects an http target on the right host", () => {
    // Downgrading the scheme is enough on its own: the origin matches on host
    // but not on protocol, and a cleartext link leaks the path.
    expect(safeExternalHref("http://gitlab.acme.dev:8443/gitlab/x", GITLAB)).toBeNull();
  });

  it("rejects a different host", () => {
    expect(safeExternalHref("https://evil.example.com/gitlab/x", GITLAB)).toBeNull();
  });

  it("rejects the same host on a different port", () => {
    // A self-managed instance is identified by origin, not by hostname: :443 and
    // :8443 on one box can be two different services.
    expect(safeExternalHref("https://gitlab.acme.dev/gitlab/x", GITLAB)).toBeNull();
    expect(safeExternalHref("https://gitlab.acme.dev:9443/gitlab/x", GITLAB)).toBeNull();
  });

  it("rejects a target whose userinfo makes it LOOK like the registered host", () => {
    // `https://<registered host>@evil.example.com/…` reads as the instance to a
    // human and parses as `evil.example.com`. Comparing PARSED origins is what
    // catches it; a raw-string `startsWith` would admit it (root `INSIGHTS.md`
    // 2026-08-28).
    expect(
      safeExternalHref("https://gitlab.acme.dev:8443@evil.example.com/x", GITLAB),
    ).toBeNull();
  });

  it("never returns an href pointing at a host other than the repository's", () => {
    // The mirror-image userinfo form — credentials in front of the RIGHT host —
    // does share the registered origin, so AC-25 does not require rejecting it.
    // What must hold either way is where the browser would actually go.
    const result = safeExternalHref("https://attacker@gitlab.acme.dev:8443/x", GITLAB);
    expect(result === null || new URL(result).host === "gitlab.acme.dev:8443").toBe(true);
  });

  it("rejects a trailing-dot host, which is a different origin to the parser", () => {
    // `gitlab.acme.dev.` resolves to the same server but is not the registered
    // origin, so admitting it would mean the origin check can be bypassed by
    // typing one extra character.
    expect(safeExternalHref("https://gitlab.acme.dev.:8443/gitlab/x", GITLAB)).toBeNull();
  });

  it("rejects a relative or unparseable target instead of throwing", () => {
    expect(safeExternalHref("/gitlab/platform/payments/api", GITLAB)).toBeNull();
    expect(safeExternalHref("javascript:alert(1)", GITLAB)).toBeNull();
  });

  it("returns null while the repository is still loading", () => {
    expect(safeExternalHref("https://github.com/acme/payments-api/pull/1", null)).toBeNull();
    expect(safeExternalHref(null, GITHUB)).toBeNull();
    expect(safeExternalHref(undefined, GITHUB)).toBeNull();
  });
});
