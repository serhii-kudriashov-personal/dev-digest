/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** Secret name (via the Secrets adapter) holding the GitHub PAT for private clones. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/**
 * Parse `owner`/`repo` out of the scp-like SSH form,
 * `git@github.com:owner/repo(.git)`. That form is NOT a valid URL, so it cannot
 * go through `new URL()` and needs its own pattern — see `parseRepoUrl`, which
 * handles every https form by host instead.
 *
 * The leading `^` is the security-relevant part: the previous unanchored version
 * matched `github.com/owner/repo` ANYWHERE in the string, so
 * `https://attacker.test/github.com/owner/repo` parsed as a valid GitHub repo
 * and the attacker's host is what got cloned.
 */
export const GITHUB_SCP_URL_REGEX = /^(?:[A-Za-z0-9._-]+@)?github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;

/** Username embedded into an authenticated https github.com clone URL. */
export const GIT_TOKEN_USERNAME = 'x-access-token';

/** Host for which a token is embedded into an https clone URL. */
export const GITHUB_HTTPS_HOST = 'github.com';
