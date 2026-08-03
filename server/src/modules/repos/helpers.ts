import { type Repo } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import {
  GITHUB_SCP_URL_REGEX,
  GIT_TOKEN_USERNAME,
  GITHUB_HTTPS_HOST,
} from './constants.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

/**
 * Parse `owner`/`name` from a GitHub URL (https or scp-like ssh form).
 *
 * The value that reaches here is user input from `POST /repos`, and the SAME
 * string is later handed to `git clone` — so this function is the only thing
 * standing between the request and an arbitrary outbound clone. It therefore
 * decides by HOST, never by substring:
 *
 *   https://attacker.test/github.com/owner/repo   → rejected (host is attacker.test)
 *   https://github.com@attacker.test/owner/repo   → rejected (host is attacker.test)
 *
 * Both of those were accepted by the previous unanchored regex, and neither
 * leaked the PAT (`withGitHubToken` re-checks the host), but both would clone
 * from the attacker's server.
 */
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const raw = url.trim();
  const reject = (why: string): never => {
    throw new AppError('invalid_repo_url', why, 400);
  };

  const scp = GITHUB_SCP_URL_REGEX.exec(raw);
  if (scp?.[1] && scp[2]) return { owner: scp[1], name: scp[2] };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return reject(`Could not parse owner/repo from '${url}'`);
  }
  if (parsed.hostname !== GITHUB_HTTPS_HOST) {
    return reject(`Only ${GITHUB_HTTPS_HOST} repositories are supported (got '${parsed.hostname}')`);
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const [owner, repo] = segments;
  if (segments.length !== 2 || !owner || !repo) {
    return reject(`Could not parse owner/repo from '${url}'`);
  }
  // Trailing `.git` only — a dot inside the name is legitimate (`owner/foo.js`),
  // which the previous `[^/.]+` pattern rejected outright.
  return { owner, name: repo.replace(/\.git$/, '') };
}

/**
 * Embed a token into an https github.com URL so private clones authenticate
 * non-interactively. SSH/non-GitHub URLs are left untouched.
 */
export function withGitHubToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === GITHUB_HTTPS_HOST) {
      u.username = GIT_TOKEN_USERNAME;
      u.password = token;
      return u.toString();
    }
  } catch {
    /* non-URL (e.g. git@github.com:...) — leave as-is */
  }
  return url;
}

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}
