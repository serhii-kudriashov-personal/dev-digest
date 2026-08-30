import { simpleGit, type SimpleGit } from 'simple-git';
import { join, resolve, dirname, sep } from 'node:path';
import { mkdir, readFile, readdir, access, rm, lstat, realpath } from 'node:fs/promises';
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
 * Bounds on the scan that authorises `clone()`'s `rm` of a `.git`-less
 * destination (`assertRemovablePartialClone`). They exist so the scan is a
 * bounded, predictable amount of work on a directory the operator did not
 * intend us to look at; exceeding either one is treated as "cannot prove this
 * is a failed partial clone", which refuses rather than deletes.
 *
 * A genuine partial clone is a handful of entries at most — git writes `.git`
 * before anything else, so a remnant WITHOUT one has barely started. A
 * directory big or deep enough to hit these limits is something else.
 */
const PARTIAL_SCAN_MAX_DEPTH = 6;
const PARTIAL_SCAN_MAX_ENTRIES = 512;

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
   *
   * WHAT THIS CHECK CANNOT DO, and where the rest of it lives. `resolve()` is
   * PURELY LEXICAL — it never touches the filesystem, so it cannot see a
   * symlink, while `mkdir(…, { recursive: true })` follows one happily. A
   * repository git checked out with `ns/A/pwn -> ../../../outside` in it makes
   * `<cloneDir>/<key>/ns/A/pwn/x` pass this check and land the write in
   * `outside/` (`server/INSIGHTS.md` 2026-08-29). The filesystem-aware half is
   * `assertRealDestContained`, and it is in `clone()` rather than here on
   * purpose: this method is SYNCHRONOUS and has nine call sites, so making it
   * async to add one `realpath` is the ripple that produced the
   * `RepoRef.instanceKey` defect (root `INSIGHTS.md` 2026-08-29). The lexical
   * check stays because it is cheap, it catches `..`, and every caller gets it.
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
    // BEFORE the `mkdir`, and therefore before every branch below that writes
    // or deletes: `clonePathFor`'s containment test is lexical and cannot see a
    // symlink on the way to `dest`. See `assertRealDestContained`.
    await this.assertRealDestContained(dest);
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
    // a .git — git clone refuses a non-empty dest, so clear it first. This
    // branch is DESTRUCTIVE and, since SPEC-06, no longer sees only leaf
    // directories: `owner` may be a multi-segment namespace, so an ordinary
    // group-level URL resolves to an INTERMEDIATE namespace directory that
    // legitimately holds other repositories' clones and, by definition, has no
    // `.git` of its own. `clonePathFor`'s containment check cannot tell the
    // difference — such a path genuinely IS inside the clone root — so the
    // removal is gated on proving the directory holds no repository at all.
    if (await this.exists(dest)) {
      await this.assertRemovablePartialClone(dest);
      await rm(dest, { recursive: true, force: true });
    }
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  /**
   * The filesystem-aware half of containment, and the one `clonePathFor`
   * structurally cannot do (`server/INSIGHTS.md` 2026-08-29).
   *
   * THE HOLE IT CLOSES. `resolve()` is a string operation. A symlink placed
   * inside an already-imported repository — git checks symlinks out by default,
   * so the link is attacker-authored content — makes a deeper destination
   * resolve *lexically* inside the clone root while `mkdir(…, {recursive:true})`
   * follows the link and lands the tree somewhere else entirely. Verified with
   * `clones/ns/A/pwn -> ../../../outside`: `clones/ns/A/pwn/x` reported
   * contained, and the write went to `outside/`. It is reachable because
   * SPEC-06 accepts a namespace of any depth, so `…/ns/A/pwn/proj` is an
   * ordinary-looking GitLab path.
   *
   * WHY A `realpath` AND NOT A DEPTH CAP. A cap does not close it: the link can
   * sit at any depth, including depth 2. Resolving the deepest EXISTING
   * ancestor is the only test that answers where the write will actually go.
   *
   * WHY IT IS HERE AND NOT IN `clonePathFor`. `clonePathFor` is synchronous and
   * has nine call sites; making it async to add a filesystem call is exactly
   * the ripple that produced the `RepoRef.instanceKey` defect (root
   * `INSIGHTS.md` 2026-08-29). `clone()` is the only writing entry point, and
   * this runs before its `mkdir`, so it gates the reuse branch, the `rm` branch
   * and the clone itself.
   *
   * FAIL CLOSED (`security` A10). Existence is probed with `lstat`, not
   * `access`, so a DANGLING symlink counts as existing and is then handed to
   * `realpath`, which throws — a refusal rather than a silent walk past it.
   * Every error resolving anything refuses; nothing is created or removed on a
   * refusal.
   */
  private async assertRealDestContained(dest: string): Promise<void> {
    const refuse = (why: string): AppError =>
      new AppError(
        'invalid_clone_path',
        `Refusing the clone destination ${dest}: ${why}. Nothing was created or removed.`,
        400,
      );

    let root: string;
    try {
      // Only the clone ROOT is created here — a directory we own, not one any
      // part of the requested path can influence — so that `realpath` below has
      // something to resolve on a first-ever clone.
      await mkdir(this.cloneDir, { recursive: true });
      root = await realpath(this.cloneDir);
    } catch {
      throw refuse('the clone directory could not be resolved');
    }

    // Walk up to the deepest ancestor that exists. `dest` itself is lexically
    // inside `cloneDir` (`clonePathFor`) and `cloneDir` now exists, so this
    // terminates at `cloneDir` at the latest; the `parent === probe` guard is
    // there so a future caller cannot turn it into an unbounded loop.
    let probe = dest;
    for (;;) {
      let present = true;
      try {
        await lstat(probe);
      } catch {
        present = false;
      }
      if (present) break;
      const parent = dirname(probe);
      if (parent === probe) throw refuse('no existing ancestor is inside the clone directory');
      probe = parent;
    }

    let real: string;
    try {
      real = await realpath(probe);
    } catch {
      throw refuse(`'${probe}' could not be resolved on disk`);
    }
    if (real !== root && !real.startsWith(root + sep)) {
      // The offending REAL path is deliberately not echoed: it is a filesystem
      // location outside our tree that the operator did not ask about.
      throw refuse('it resolves through a symlink to a location outside the clone directory');
    }
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

  /**
   * Authorise `clone()`'s `rm -rf` of a destination that exists but holds no
   * `.git` of its own — the sibling branch of `assertSameRemote`, and the one
   * with no guard at all before this.
   *
   * WHAT IT IS PROTECTING. Before SPEC-06 `dest` was always a leaf
   * `<cloneDir>/<owner>/<name>`, so "exists but has no `.git`" could only mean a
   * clone that died mid-write. With a multi-segment `owner`, an ordinary
   * group-level URL (`https://gitlab.example.com/group/sub`) resolves to
   * `<cloneDir>/<key>/group/sub` — a real NAMESPACE directory holding other
   * repositories' clones, which by definition has no `.git` of its own and
   * which containment happily approves because it really is inside the clone
   * root. The clone root is not partitioned by workspace, so those siblings can
   * belong to any tenant, and this tree is a mirror that `reset --hard`s on
   * sync (root `INSIGHTS.md` 2026-08-16) — a user's data, not a cache.
   *
   * THE TEST IT APPLIES. Identity cannot be established here: with no `.git`
   * there is no remote to compare against, so "a failed partial clone OF THIS
   * repository" is not decidable. What IS decidable is whether the directory
   * holds any git repository at all, so removal is allowed only when the tree
   * contains no `.git` entry at any depth — a directory holding one, or holding
   * one nested arbitrarily deep, is refused untouched. Anything the scan cannot
   * answer within its bounds (unreadable directory, too many entries, too deep)
   * is ambiguous and therefore also refused: `security` A10, fail closed.
   * Nothing is removed on any refusal.
   *
   * Symlinks are not followed, which matches `rm(..., { recursive: true })` —
   * it unlinks a symlink rather than descending through it, so a link cannot
   * hide a clone from the scan that the removal would then destroy.
   */
  private async assertRemovablePartialClone(dest: string): Promise<void> {
    const conflict = (why: string): AppError =>
      new AppError(
        'clone_destination_conflict',
        `The clone directory ${dest} already exists and ${why}, so it is not a failed partial clone. Nothing was removed; remove it by hand or re-import under a different instance.`,
        409,
      );

    const stack: { path: string; depth: number }[] = [{ path: dest, depth: 0 }];
    let seen = 0;
    while (stack.length > 0) {
      const { path, depth } = stack.pop()!;
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch {
        throw conflict('could not be read');
      }
      for (const entry of entries) {
        seen += 1;
        if (seen > PARTIAL_SCAN_MAX_ENTRIES) {
          throw conflict(`holds more than ${PARTIAL_SCAN_MAX_ENTRIES} entries`);
        }
        // A gitlink (submodule / worktree) spells `.git` as a FILE, so the name
        // is what matters, not the type.
        if (entry.name === '.git') throw conflict('holds a git repository');
        // `isDirectory()` is false for a symlink, which is what keeps the scan
        // inside the tree `rm` would actually delete.
        if (!entry.isDirectory()) continue;
        if (depth + 1 > PARTIAL_SCAN_MAX_DEPTH) {
          throw conflict(`is nested more than ${PARTIAL_SCAN_MAX_DEPTH} levels deep`);
        }
        stack.push({ path: join(path, entry.name), depth: depth + 1 });
      }
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
