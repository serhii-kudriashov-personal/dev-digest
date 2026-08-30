import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { AppError } from '../src/platform/errors.js';

/**
 * Clone identity and clone isolation (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-17, AC-18, AC-19).
 *
 * HERMETIC, and the remotes are LOCAL DIRECTORIES on purpose. That is not a
 * convenience: `server/INSIGHTS.md` 2026-08-28 records that a same-remote guard
 * which classifies remotes by parsing them as URLs fails closed on a filesystem
 * remote, so the refusal looks right while the REUSE path becomes unreachable
 * and AC-18's happy case cannot be exercised at all. Both directions are
 * asserted below for exactly that reason.
 *
 * Why this file earns its runtime: `sync()` runs `reset --hard` on the clone
 * (root `INSIGHTS.md` 2026-08-16), so choosing the wrong directory here is not
 * a misread — it destroys the other repository's mirror while the UI names this
 * one.
 */

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A real git repository on disk, usable as a clone source. */
async function makeRemote(root: string, name: string, content: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-b', 'main', '--quiet');
  git(dir, 'config', 'user.email', 'test@devdigest.invalid');
  git(dir, 'config', 'user.name', 'DevDigest Test');
  await writeFile(join(dir, 'README.md'), content, 'utf8');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', `seed ${name}`);
  return dir;
}

async function commitMore(dir: string, content: string): Promise<string> {
  await writeFile(join(dir, 'later.md'), content, 'utf8');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'later');
  return git(dir, 'rev-parse', 'HEAD');
}

/** Does this clone hold the given commit object at all? */
function hasCommit(dest: string, sha: string): boolean {
  try {
    git(dest, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

describe('clone isolation', () => {
  let root: string;
  let cloneDir: string;
  let client: SimpleGitClient;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dd-clone-iso-'));
    cloneDir = join(root, 'clones');
    await mkdir(cloneDir, { recursive: true });
    client = new SimpleGitClient(cloneDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // clonePathFor — identity (AC-17) and back-compat (AC-19)
  // -------------------------------------------------------------------------

  describe('clonePathFor', () => {
    it('AC-19: a RepoRef with no instanceKey keeps the pre-SPEC-06 location, byte for byte', () => {
      // The exact string, not a shape: every clone already on disk lives here,
      // and `repos.clone_path` already stores this value.
      expect(client.clonePathFor({ owner: 'a', name: 'b' })).toBe(`${cloneDir}/a/b`);
    });

    it('AC-19: the explicit github.com key resolves to the same string', () => {
      expect(client.clonePathFor({ owner: 'a', name: 'b', instanceKey: 'github.com' })).toBe(
        `${cloneDir}/a/b`,
      );
      // An empty key is the third spelling of "the built-in host" and must not
      // produce `<cloneDir>//a/b` or a key-named directory.
      expect(client.clonePathFor({ owner: 'a', name: 'b', instanceKey: '' })).toBe(
        `${cloneDir}/a/b`,
      );
    });

    it('AC-17: a registered instance nests its repositories under its own key', () => {
      expect(
        client.clonePathFor({ owner: 'a', name: 'b', instanceKey: 'gitlab.example.com' }),
      ).toBe(`${cloneDir}/gitlab.example.com/a/b`);
    });

    it('AC-16/AC-17: the same namespace path on two instances gets two distinct locations', () => {
      const one = client.clonePathFor({ owner: 'acme', name: 'api', instanceKey: 'gitlab.one' });
      const two = client.clonePathFor({ owner: 'acme', name: 'api', instanceKey: 'gitlab.two' });
      const github = client.clonePathFor({ owner: 'acme', name: 'api' });
      expect(new Set([one, two, github]).size).toBe(3);
    });

    it('a nested namespace keeps every group segment in the path', () => {
      expect(
        client.clonePathFor({
          owner: 'group/subgroup/team',
          name: 'project',
          instanceKey: 'gitlab.example.com',
        }),
      ).toBe(`${cloneDir}/gitlab.example.com/group/subgroup/team/project`);
    });

    describe('refuses any destination outside the clone directory', () => {
      const traversals: [string, { owner: string; name: string; instanceKey?: string }][] = [
        ['owner escaping with ../..', { owner: '../..', name: 'x', instanceKey: 'k' }],
        ['owner escaping on the legacy branch', { owner: '../..', name: 'x' }],
        ['name escaping', { owner: 'a', name: '../../../etc', instanceKey: 'k' }],
        ['instanceKey escaping', { owner: 'a', name: 'b', instanceKey: '../../..' }],
        // Not a traversal but not a destination either: this resolves to the
        // clone root itself, which must not be treated as a repository.
        ['an empty owner and name', { owner: '', name: '' }],
      ];
      for (const [label, ref] of traversals) {
        it(label, () => {
          let thrown: unknown;
          try {
            client.clonePathFor(ref);
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(AppError);
          expect((thrown as AppError).code).toBe('invalid_clone_path');
        });
      }

      it('an absolute-looking owner is joined as a relative segment and stays contained', () => {
        // `path.join` — unlike `path.resolve` — does not honour a leading `/`
        // in a later argument, so this is contained rather than refused. The
        // assertion is that it stays under the clone root, which is the
        // property AC-18 and the mirror's `reset --hard` actually depend on.
        expect(client.clonePathFor({ owner: '/etc', name: 'passwd', instanceKey: 'k' })).toBe(
          `${cloneDir}/k/etc/passwd`,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // clone() — AC-18, the data-loss case
  // -------------------------------------------------------------------------

  describe('clone() into a destination that already holds a clone', () => {
    it('AC-18: refuses a foreign remote, fetches nothing, and leaves the existing clone untouched', async () => {
      const remoteX = await makeRemote(root, 'origin-x', 'this is repository X');
      const remoteY = await makeRemote(root, 'origin-y', 'this is repository Y');
      const shaY = git(remoteY, 'rev-parse', 'HEAD');

      const ref = { owner: 'acme', name: 'api', instanceKey: 'gitlab.one' };
      const { path: dest } = await client.clone(ref, remoteX);

      // Everything the failed import must not disturb, recorded first.
      const before = {
        origin: git(dest, 'remote', 'get-url', 'origin'),
        head: git(dest, 'rev-parse', 'HEAD'),
        refs: git(dest, 'show-ref'),
        status: git(dest, 'status', '--porcelain'),
        readme: await readFile(join(dest, 'README.md'), 'utf8'),
      };
      expect(before.readme).toBe('this is repository X');

      let thrown: unknown;
      try {
        await client.clone(ref, remoteY);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe('clone_destination_conflict');
      expect((thrown as AppError).statusCode).toBe(409);
      // The failure names the collision (AC-18), so the operator can act on it.
      expect((thrown as AppError).message).toContain(dest);

      // 1. The pre-existing clone still points at X.
      expect(git(dest, 'remote', 'get-url', 'origin')).toBe(before.origin);
      expect(git(dest, 'remote', 'get-url', 'origin')).toBe(remoteX);
      // 2. Its working tree is unmodified.
      expect(await readFile(join(dest, 'README.md'), 'utf8')).toBe('this is repository X');
      expect(git(dest, 'rev-parse', 'HEAD')).toBe(before.head);
      expect(git(dest, 'status', '--porcelain')).toBe(before.status);
      // 3. NOTHING was fetched: not one object of Y's history reached the
      //    destination, and no ref moved. This is the assertion that stands
      //    between AC-18 and `sync()`'s later `reset --hard`.
      expect(hasCommit(dest, shaY)).toBe(false);
      expect(git(dest, 'show-ref')).toBe(before.refs);
    });

    it('fails closed on a destination whose origin cannot be read', async () => {
      const remoteX = await makeRemote(root, 'origin-x', 'X');
      const ref = { owner: 'acme', name: 'api' };
      const { path: dest } = await client.clone(ref, remoteX);
      git(dest, 'remote', 'remove', 'origin');

      let thrown: unknown;
      try {
        await client.clone(ref, remoteX);
      } catch (err) {
        thrown = err;
      }
      // A directory holding a clone we cannot identify is foreign, not assumed
      // to match — an unreadable origin must never open the fetch path.
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe('clone_destination_conflict');
    });

    it('reuses and fetches when the remote is the same one (the case the URL parser broke)', async () => {
      const remoteX = await makeRemote(root, 'origin-x', 'X');
      const ref = { owner: 'acme', name: 'api', instanceKey: 'gitlab.one' };
      const first = await client.clone(ref, remoteX);

      // A commit that exists only upstream at the moment of the re-clone.
      const later = await commitMore(remoteX, 'added after the first clone');
      expect(hasCommit(first.path, later)).toBe(false);

      const second = await client.clone(ref, remoteX);

      expect(second.path).toBe(first.path);
      // Reuse actually fetched: the resumed import sees upstream's new history.
      expect(hasCommit(second.path, later)).toBe(true);
    });

    it('a trailing slash on the same filesystem remote is still the same remote', async () => {
      const remoteX = await makeRemote(root, 'origin-x', 'X');
      const ref = { owner: 'acme', name: 'api' };
      await client.clone(ref, remoteX);
      const later = await commitMore(remoteX, 'again');

      const reused = await client.clone(ref, `${remoteX}/`);
      expect(hasCommit(reused.path, later)).toBe(true);
    });
  });
});
