/**
 * The persisted form of a failed forge sync (SPEC-06 — AC-44, NFR-7). PURE: no
 * I/O, no DB, no container.
 *
 * WHY IT LIVES IN `_shared/` AND NOT IN A SLICE. Two slices write the same
 * column: `polling` on `POST /repos/:id/poll`, `pulls` on the local-first sync
 * inside `GET /repos/:id/pulls`. A slice's `helpers.ts` is `SLICE_PRIVATE` and
 * `no-cross-slice-import` blocks it, while an off-manifest filename under
 * `modules/_shared/` is importable by every slice (`server/INSIGHTS.md`
 * 2026-08-17).
 *
 * WHAT IT IS FOR, IN ONE LINE. The reason a sync failed originates in a forge
 * we do not control, so it is THIRD-PARTY-INFLUENCED TEXT that we are about to
 * store and later show to a human. Two properties must hold before it reaches
 * `repos.last_sync_error`:
 *
 *  1. BOUNDED. An instance chooses how long its own error strings are; the
 *     column would otherwise hold whatever it sent. Capped at
 *     `SYNC_ERROR_MAX_LENGTH` with an explicit ellipsis, so a truncated message
 *     reads as truncated rather than as a complete sentence.
 *  2. CREDENTIAL-FREE. `withGitHubToken` / `withInstanceToken` embed an access
 *     key in a clone URL as `user:pass@host`, and an adapter or library error
 *     may quote the URL it was given. Every absolute URL is therefore replaced
 *     wholesale — not just its userinfo — because a URL is also the one place a
 *     token tends to sit in a query string. Known token shapes are redacted on
 *     top of that, for the case where one appears outside a URL at all.
 *
 * This is the same discipline `adapters/gitlab/http.ts` applies when composing
 * its own messages (built from the method and path, never from the response)
 * and `simple-git.ts#assertSameRemote` applies to a remote (compared, never
 * echoed). The difference is that this function sees error text those two did
 * not compose — an Octokit error, a `fetch` failure, a driver message — so it
 * assumes nothing about the shape and strips rather than trusts.
 *
 * It deliberately does NOT try to classify the failure. A typed reason belongs
 * on a contract; this column is prose for a human, and pretending otherwise
 * would invite a consumer to string-match it.
 */

/**
 * Characters kept, ellipsis included. Long enough for a real forge sentence
 * ("HTTP 403: Your account has been blocked"), short enough that a hostile
 * instance cannot use the column as storage.
 */
export const SYNC_ERROR_MAX_LENGTH = 300;

/** What is stored when the failure carries no usable message at all. */
export const SYNC_ERROR_FALLBACK = 'The forge could not be reached.';

/** `scheme://…` up to the first whitespace, quote or closing bracket. */
const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>)\]]+/gi;

/**
 * `user:pass@host` outside a URL — what is left of an embedded credential once
 * the scheme has been stripped by something upstream.
 */
const BARE_USERINFO = /\b[^\s:@/]+:[^\s:@/]+@[^\s/]+/g;

/**
 * Token shapes that identify themselves by prefix. Not an attempt at generic
 * secret detection — a high-entropy heuristic would eat commit shas, which are
 * exactly what a useful git error contains.
 */
const KNOWN_TOKENS = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|glrt-[A-Za-z0-9_-]{16,})\b/g;

/**
 * The value to persist in `repos.last_sync_error` for a failed sync.
 *
 * Fail-safe rather than fail-closed, and the asymmetry is deliberate: this is a
 * diagnostic, not an authorisation decision (`security` A10 governs the latter).
 * Anything unusable — a non-`Error` throw, an empty message, a message that is
 * nothing but a redacted URL — becomes `SYNC_ERROR_FALLBACK`, so the column
 * always answers "the last sync failed" even when it cannot say why.
 */
export function toSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  const redacted = raw
    .replace(ABSOLUTE_URL, '[url]')
    .replace(BARE_USERINFO, '[redacted]')
    .replace(KNOWN_TOKENS, '[redacted]')
    // Control characters — a forge can put a newline or an ANSI escape in
    // its own error text, and this string ends up in a log line and on a
    // screen. Written as escapes so the source file stays plain text.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A message that survived redaction as nothing but placeholders says less
  // than the fallback does.
  if (redacted === '' || /^(?:\[url\]|\[redacted\]|\s)+$/.test(redacted)) {
    return SYNC_ERROR_FALLBACK;
  }
  if (redacted.length <= SYNC_ERROR_MAX_LENGTH) return redacted;
  return `${redacted.slice(0, SYNC_ERROR_MAX_LENGTH - 1).trimEnd()}…`;
}
