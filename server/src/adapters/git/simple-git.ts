import { simpleGit, type SimpleGit } from 'simple-git';
import { join, resolve, dirname, sep } from 'node:path';
import { mkdir, readFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { AppError } from '../../platform/errors.js';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * The instance key the built-in github.com host uses. A `RepoRef` carrying this
 * key — or none at all — takes the pre-SPEC-06 two-segment layout, byte for
 * byte, which is what makes every clone already on disk keep working (AC-19).
 * Duplicated from `modules/repos/constants.ts` rather than imported: an adapter
 * importing a slice is the direction `no-adapter-impl-outside-root` exists to
 * keep out (`backend-onion-architecture` §4).
 */
const BUILTIN_INSTANCE_KEY = 'github.com';

/**
 * GitClient over simple-git. Repos clone to `<cloneDir>/<owner>/<repo>` for the
 * built-in github.com host and `<cloneDir>/<instanceKey>/<owner>/<repo>` for a
 * registered instance. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  /**
   * Where one repository's clone lives (SPEC-06 — AC-17).
   *
   * TWO THINGS THIS FUNCTION IS RESPONSIBLE FOR, and neither is cosmetic.
   *
   * 1. IDENTITY. Before SPEC-06 the path was two segments, so the same
   *    `owner/name` on two hosts — and any nested GitLab namespace — collapsed
   *    onto one directory. That is not a read-only mix-up: `sync()` runs
   *    `reset --hard`, so the loser's working tree is clobbered
   *    (`server/INSIGHTS.md` 2026-08-28, root `INSIGHTS.md` 2026-08-16). The
   *    instance key is therefore part of the path for every non-github.com
   *    repository, and ABSENT for github.com so existing clones keep their
   *    location byte for byte.
   * 2. CONTAINMENT. `repo.owner` is user-influenced and, for a nested
   *    namespace, holds several path segments — so `join()` here is
   *    `path.join()` with user input, which allows traversal (`security`
   *    §Framework Security Quirks). `_shared/forge-url.ts` already refuses
   *    `.`, `..` and encoded separators upstream; this check is the second
   *    line, and it fails closed.
   *
   * The returned string is the JOINED form, not the resolved one: `resolve()`
   * is used only to decide containment, because the joined form is what is
   * already persisted in `repos.clone_path`.
   */
  clonePathFor(repo: RepoRef): string {
    const key = repo.instanceKey;
    const dest =
      key === undefined || key === '' || key === BUILTIN_INSTANCE_KEY
        ? join(this.cloneDir, repo.owner, repo.name)
        : join(this.cloneDir, key, repo.owner, repo.name);

    // Strictly INSIDE the root: the clone directory itself is not a valid
    // destination either, which is what an empty owner or name would produce.
    const root = resolve(this.cloneDir);
    const full = resolve(dest);
    if (!full.startsWith(root + sep)) {
      throw new AppError(
        'invalid_clone_path',
        `Refusing a clone destination outside the clone directory for '${repo.owner}/${repo.name}'`,
        400,
      );
    }
    return dest;
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    // `dirname(dest)` rather than `<cloneDir>/<owner>`: an instance-scoped or
    // nested-namespace destination is deeper than two segments, and for the
    // legacy layout the two are the same string.
    await mkdir(dirname(dest), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // Reusing a directory that already holds a clone is deliberate (it
      // resumes a partial import) — but ONLY when it holds a clone of the same
      // remote. Reusing a foreign one would fetch into, and later
      // `reset --hard`, an unrelated repository's mirror while the UI names
      // this one (AC-18; `server/INSIGHTS.md` 2026-08-28, root `INSIGHTS.md`
      // 2026-08-16). Checked BEFORE the fetch, so a collision touches nothing.
      await this.assertSameRemote(dest, url);
      // already cloned → fetch latest
      await simpleGit(dest).fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  /**
   * Refuse to reuse a destination that already holds a clone of a DIFFERENT
   * remote (AC-18).
   *
   * Comparison is on host + path with the userinfo dropped, because the stored
   * remote and the requested URL differ in exactly the ways that do not change
   * which repository they name: an embedded credential (`withGitHubToken` /
   * `withInstanceToken` put one in), a trailing `.git`, a trailing slash, and
   * host case. Everything else counts as a different repository, and the
   * comparison FAILS CLOSED — an origin that cannot be read or parsed is
   * treated as foreign rather than assumed to match.
   *
   * Neither the requested URL nor the stored one appears in the message: both
   * may carry a credential.
   */
  private async assertSameRemote(dest: string, url: string): Promise<void> {
    let stored: string;
    try {
      stored = (await simpleGit(dest).raw(['remote', 'get-url', 'origin'])).trim();
    } catch {
      throw new AppError(
        'clone_destination_conflict',
        `The clone directory ${dest} already exists but has no 'origin' remote. Remove it and re-import.`,
        409,
      );
    }
    const want = remoteIdentity(url);
    const have = remoteIdentity(stored);
    if (want === null || have === null || want !== have) {
      throw new AppError(
        'clone_destination_conflict',
        `The clone directory ${dest} already holds a different repository. Nothing was fetched; remove that directory or re-import under a different instance.`,
        409,
      );
    }
  }

  async fetchPullHead(repo: RepoRef, n: number): Promise<void> {
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head).
    await this.git(repo).fetch(['origin', `pull/${n}/head:pr-${n}`]);
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }
}

/**
 * `host/path` for a git remote, with the credential, the trailing `.git` and
 * any trailing slash removed — `null` when the string carries no repository at
 * all (which callers treat as foreign).
 *
 * Three forms, because all three reach `clone()`:
 *  - an https URL, which `withGitHubToken` / `withInstanceToken` may have put a
 *    credential into — hence comparing host + path rather than the whole string;
 *  - the scp-like SSH form (`git@github.com:owner/repo.git`), which is not a URL
 *    and which `add` clones verbatim when the operator imports with it;
 *  - a plain filesystem path, which is neither, and is compared literally.
 */
function remoteIdentity(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes('://')) {
    return normalizeRemoteParts(scp[1]!, scp[2]!);
  }
  try {
    const u = new URL(trimmed);
    return normalizeRemoteParts(u.host, u.pathname);
  } catch {
    // Not a URL and not the scp form — a local path. Two of them name the same
    // repository exactly when they are the same string, so compare them as one.
    const local = trimmed.replace(/\/+$/, '').replace(/\.git$/, '');
    return local === '' ? null : local;
  }
}

function normalizeRemoteParts(host: string, path: string): string | null {
  const p = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (p === '') return null;
  return `${host.toLowerCase()}/${p}`;
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
