import { type Repo, type RepoProvider } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import { matchOrigin, namespacePathFrom } from '../_shared/forge-url.js';
import {
  GITHUB_SCP_URL_REGEX,
  GIT_TOKEN_USERNAME,
  GITHUB_HTTPS_HOST,
  BUILTIN_INSTANCE_KEY,
  BUILTIN_INSTANCE_LABEL,
  GITHUB_WEB_BASE,
  INSTANCE_TOKEN_USERNAME,
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
 * The minimum a registered instance must expose to resolve a repository URL.
 *
 * Structural on purpose: `git_instances` rows reach this slice through
 * `container.instancesRepo`, which is the sanctioned cross-slice channel
 * (`backend-onion-architecture` §4). Importing the other slice's
 * `repository.ts` for its row type would not be — that file is `SLICE_PRIVATE`.
 */
export interface ForgeInstance {
  id: string;
  provider: RepoProvider;
  /** Normalized origin + optional path prefix, no trailing slash. */
  baseUrl: string;
  instanceKey: string;
  label: string;
}

/** Everything `service.add` needs to persist and clone one repository. */
export interface ResolvedRepoUrl {
  provider: RepoProvider;
  /** `null` ⇒ the built-in github.com host, which is not a `git_instances` row. */
  instanceId: string | null;
  instanceKey: string;
  owner: string;
  name: string;
  fullName: string;
  namespacePath: string;
  /** The URL to clone from, WITHOUT any credential. */
  cloneUrl: string;
  /** The owning instance, or `null` for the built-in host. */
  instance: ForgeInstance | null;
}

/** Is this a github.com URL in either supported form? Host equality, never a substring. */
function isGitHubUrl(raw: string): boolean {
  if (GITHUB_SCP_URL_REGEX.test(raw)) return true;
  try {
    return new URL(raw).hostname === GITHUB_HTTPS_HOST;
  } catch {
    return false;
  }
}

/**
 * Resolve an imported repository URL against github.com and the workspace's
 * registered instances (SPEC-06 — AC-13, AC-14, AC-15, AC-19, NFR-4).
 *
 * TWO PROPERTIES THIS FUNCTION EXISTS FOR, both security ones:
 *
 * 1. The URL can only ever SELECT an already-registered destination — it can
 *    never introduce one. An unmatched origin is refused; nothing here derives
 *    an outbound host from user input (`security` §A05/§A08).
 * 2. The github.com branch is byte-identical to the pre-SPEC-06 behaviour: same
 *    `parseRepoUrl`, same two-segment shape, same clone URL, same errors
 *    (AC-19, AC-27). Only a URL that is NOT github.com reaches the new path.
 *
 * The namespace is taken at any depth for an instance (`group/sub/team/proj`),
 * with `owner` holding every segment but the last. `_shared/forge-url.ts` has
 * already refused `.`/`..` and encoded separators by then, which matters because
 * `owner` becomes a directory name under the clone root.
 */
export function resolveRepoUrl(
  url: string,
  instances: readonly ForgeInstance[],
): ResolvedRepoUrl {
  const raw = url.trim();

  if (isGitHubUrl(raw)) {
    const { owner, name } = parseRepoUrl(raw);
    const fullName = `${owner}/${name}`;
    return {
      provider: 'github',
      instanceId: null,
      instanceKey: BUILTIN_INSTANCE_KEY,
      owner,
      name,
      fullName,
      namespacePath: fullName,
      // Unchanged: today's `add` clones the string the user supplied, which is
      // what keeps an ssh (`git@github.com:…`) import working.
      cloneUrl: raw,
      instance: null,
    };
  }

  const instance = matchOrigin(raw, instances);
  const namespacePath = instance === null ? null : namespacePathFrom(raw, instance);
  if (instance === null || namespacePath === null) {
    const known = [GITHUB_WEB_BASE, ...instances.map((i) => i.baseUrl)].join(', ');
    throw new AppError(
      'invalid_repo_url',
      `'${url}' does not belong to any registered forge. Registered: ${known}`,
      400,
    );
  }

  const segments = namespacePath.split('/');
  const name = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join('/');
  return {
    provider: instance.provider,
    instanceId: instance.id,
    instanceKey: instance.instanceKey,
    owner,
    name,
    fullName: namespacePath,
    namespacePath,
    cloneUrl: cloneUrlFor(namespacePath, instance),
    instance,
  };
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

/**
 * Embed a token into an https URL belonging to ONE registered instance, so a
 * private clone authenticates non-interactively (AC-15).
 *
 * Sibling of `withGitHubToken` and deliberately the same discipline: the token
 * is embedded only when the URL's origin is host-EQUAL to the instance's own,
 * never when it merely contains or resembles it. Anything else is returned
 * untouched, so a mis-resolved URL leaks nothing.
 */
export function withInstanceToken(url: string, credential: string, baseUrl: string): string {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (u.protocol === 'https:' && base.protocol === 'https:' && u.host === base.host) {
      u.username = INSTANCE_TOKEN_USERNAME;
      u.password = credential;
      return u.toString();
    }
  } catch {
    /* non-URL — leave as-is */
  }
  return url;
}

/**
 * The credential-free URL `git clone` is given for a repository, derived from
 * the instance that owns it. `null` ⇒ the built-in github.com host, which
 * reproduces exactly the string `refresh` has always built.
 */
export function cloneUrlFor(namespacePath: string, instance: ForgeInstance | null): string {
  const base = instance ? instance.baseUrl : GITHUB_WEB_BASE;
  return `${base}/${namespacePath}.git`;
}

/** The instance a repo row belongs to, or `null` for the built-in github.com host. */
export function instanceFor(
  instanceId: string | null,
  instances: readonly ForgeInstance[],
): ForgeInstance | null {
  if (instanceId === null) return null;
  return instances.find((i) => i.id === instanceId) ?? null;
}

/**
 * Map a persisted repo row to the API `Repo` DTO.
 *
 * SPEC-06 — the provider fields are derived, never stored twice. A row with no
 * owning instance (`instance_id` NULL) is the built-in github.com host, and is
 * reported with the literals in `constants.ts`; that is the whole of AC-19's
 * "a pre-feature repository keeps working with no re-import", because every new
 * column carries a non-volatile default the migration backfills for free.
 *
 * `namespace_path` falls back to `full_name` when the column is still `''` —
 * the value every pre-feature row carries, since a column DEFAULT cannot copy
 * another column and a backfilling `UPDATE` is what AC-19 rules out.
 */
export function toRepoDto(
  row: typeof t.repos.$inferSelect,
  instance: ForgeInstance | null = null,
): Repo {
  const namespacePath = row.namespacePath === '' ? row.fullName : row.namespacePath;
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
    provider: row.provider,
    instance_id: row.instanceId,
    namespace_path: namespacePath,
    instance_label: instance?.label ?? BUILTIN_INSTANCE_LABEL,
    web_url: instance
      ? `${instance.baseUrl}/${namespacePath}`
      : `${GITHUB_WEB_BASE}/${namespacePath}`,
  };
}
