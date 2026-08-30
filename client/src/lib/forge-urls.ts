/* forge-urls.ts — provider-aware deep links, built from the OWNING repository.
   SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) — AC-25, AC-29, AC-30.

   Replaces `lib/github-urls.ts` and the second, independent builder that lived
   at `repos/[repoId]/conventions/_components/ConventionCard/helpers.ts`
   (`client/INSIGHTS.md` 2026-08-28 — `githubBlobUrl` existed TWICE under two
   different signatures). A builder consumed by two route trees is a shared
   `src/lib/` module, not a route-local helper (`frontend-ui-architecture` §1/§2).

   The rule that makes this file worth having: EVERY link is derived from the
   repository's own `web_url` (AC-29). There is no host constant here, because a
   self-managed GitLab lives wherever the operator registered it. */

import type { ConventionCandidate } from "@devdigest/shared";
import type { Repo, RepoProvider } from "./types";

/**
 * The repository fields a deep link — and the label beside it — needs.
 *
 * A structural subset of `Repo`, so any repository DTO satisfies it and a test
 * can build one by hand without inventing the other twelve fields.
 * `instance_label` is here rather than in a second type because every surface
 * that renders a forge link also has to say WHICH forge it points at, in text
 * (AC-31), and splitting the two would make every caller thread two props.
 */
export type ForgeRepoRef = Pick<Repo, "provider" | "web_url" | "instance_label">;

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

/** `web_url` without a trailing slash — every builder appends its own. */
function base(repo: ForgeRepoRef): string {
  return repo.web_url.replace(/\/+$/, "");
}

/**
 * The `#L…` fragment for a line range, in the provider's own shape.
 *
 * GitHub writes `#L1-L2`. GitLab writes `#L1-2` — the end line carries NO
 * repeated `L` (AC-30, root `INSIGHTS.md` 2026-08-28). It is one character, it
 * silently lands the reader on the wrong anchor rather than erroring, and no
 * gate in this repo can see it.
 */
function lineAnchor(provider: RepoProvider, startLine?: number, endLine?: number): string {
  if (startLine == null) return "";
  if (endLine == null || endLine === startLine) return `#L${startLine}`;
  return provider === "gitlab" ? `#L${startLine}-${endLine}` : `#L${startLine}-L${endLine}`;
}

/**
 * The repository's own URL for one change request.
 *
 * `{web_url}/pull/{n}` on GitHub, `{web_url}/-/merge_requests/{iid}` on GitLab.
 * The number is the same integer for both providers — the store keys change
 * requests by repository plus integer, and GitLab's `iid` fills that slot
 * (AC-21), so nothing here has to translate an identifier.
 */
export function changeRequestUrl(repo: ForgeRepoRef, number: number): string {
  return repo.provider === "gitlab"
    ? `${base(repo)}/-/merge_requests/${number}`
    : `${base(repo)}/pull/${number}`;
}

/**
 * A file blob at a revision, optionally anchored to a line range.
 *
 * `sha` pins the link to the change request's head so the line numbers stay
 * accurate.
 */
export function blobUrl(
  repo: ForgeRepoRef,
  sha: string,
  file: string,
  startLine?: number,
  endLine?: number,
): string {
  const path = repo.provider === "gitlab" ? "/-/blob/" : "/blob/";
  return `${base(repo)}${path}${sha}/${encPath(file)}${lineAnchor(repo.provider, startLine, endLine)}`;
}

/**
 * Blob URL for a convention candidate's evidence, with its line range anchored.
 *
 * Pinned to the repository's default branch, not to a commit — so the file
 * always opens, but the `#L` anchor drifts once those lines move. That is the
 * honest trade for not storing a sha per candidate: the range was computed
 * against the clone as it stood at scan time, and nothing records which commit
 * that was. If the anchor ever needs to be permanent, add `conventions.head_sha`
 * and prefer it here — the change is additive, since a missing sha falls back
 * to this.
 *
 * Returns null when there is nothing safe to link: no repository loaded yet, or
 * no path.
 */
export function conventionEvidenceUrl(
  c: ConventionCandidate,
  repo: (ForgeRepoRef & { default_branch: string }) | undefined | null,
): string | null {
  if (!repo || !c.evidence_path) return null;
  const { evidence_line_start: start, evidence_line_end: end } = c;
  // A range the gate could not compute is stored as 0 — link the file, not `#L0`.
  if (!start) return blobUrl(repo, repo.default_branch, c.evidence_path);
  return blobUrl(repo, repo.default_branch, c.evidence_path, start, end ?? start);
}

/**
 * An external link target, admitted only if it is safe to render (AC-25).
 *
 * Returns `null` unless the target is `https:` AND shares the repository's
 * registered origin. A `null` result renders NO clickable element at all — not
 * a disabled-looking one — because there is nowhere trustworthy to send the
 * reader.
 *
 * Both sides are compared as PARSED origins, never as raw strings: Node's and
 * the browser's WHATWG `URL` already fold the obfuscated-host and
 * percent-encoded-dot-segment evasion sets, and a check that pattern-matches
 * the raw text gets none of that (root `INSIGHTS.md` 2026-08-28).
 */
export function safeExternalHref(
  target: string | null | undefined,
  repo: ForgeRepoRef | null | undefined,
): string | null {
  if (!target || !repo?.web_url) return null;
  let parsed: URL;
  let origin: URL;
  try {
    parsed = new URL(target);
    origin = new URL(repo.web_url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.origin !== origin.origin) return null;
  return parsed.href;
}
