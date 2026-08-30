import { describe, it, expect } from 'vitest';
import {
  parseRepoUrl,
  resolveRepoUrl,
  toRepoDto,
  type ForgeInstance,
} from '../src/modules/repos/helpers.js';
import * as t from '../src/db/schema.js';

/**
 * `parseRepoUrl` is a security boundary, not just a parser: the string it
 * accepts is the string `runCloneJob` hands to `git clone`. These tests exist
 * because the original implementation matched `github.com/owner/repo` as a
 * SUBSTRING, so a URL on any host that merely contained that path was accepted
 * and cloned from the attacker's server.
 */
describe('parseRepoUrl', () => {
  describe('accepts real GitHub URLs', () => {
    const cases: [string, { owner: string; name: string }][] = [
      ['https://github.com/acme/widgets', { owner: 'acme', name: 'widgets' }],
      ['https://github.com/acme/widgets.git', { owner: 'acme', name: 'widgets' }],
      ['https://github.com/acme/widgets/', { owner: 'acme', name: 'widgets' }],
      ['http://github.com/acme/widgets', { owner: 'acme', name: 'widgets' }],
      ['  https://github.com/acme/widgets  ', { owner: 'acme', name: 'widgets' }],
      ['git@github.com:acme/widgets.git', { owner: 'acme', name: 'widgets' }],
      ['git@github.com:acme/widgets', { owner: 'acme', name: 'widgets' }],
      // A dot inside the repo name is legitimate and used to be rejected.
      ['https://github.com/acme/widgets.js', { owner: 'acme', name: 'widgets.js' }],
    ];
    for (const [url, expected] of cases) {
      it(url.trim(), () => expect(parseRepoUrl(url)).toEqual(expected));
    }
  });

  describe('rejects anything not actually hosted on github.com', () => {
    const hostile = [
      // The regression this test was written for: github.com in the PATH.
      'https://attacker.test/github.com/acme/widgets',
      'https://attacker.test/github.com/acme/widgets.git',
      // github.com as the USERINFO, not the host — the classic URL-parsing trap.
      'https://github.com@attacker.test/acme/widgets',
      // Lookalike hosts.
      'https://github.com.attacker.test/acme/widgets',
      'https://notgithub.com/acme/widgets',
      'https://gitlab.com/acme/widgets',
      // scp-like form on a foreign host.
      'git@attacker.test:acme/widgets.git',
    ];
    for (const url of hostile) {
      it(url, () => expect(() => parseRepoUrl(url)).toThrow(/github\.com|parse/i));
    }
  });

  describe('rejects malformed input', () => {
    for (const url of [
      '',
      'not a url',
      'https://github.com',
      'https://github.com/acme',
      'https://github.com/acme/widgets/extra',
    ]) {
      it(JSON.stringify(url), () => expect(() => parseRepoUrl(url)).toThrow());
    }
  });
});

/**
 * `resolveRepoUrl` is the SPEC-06 replacement for the single-host allowlist
 * (`specs/2026-08-28-gitlab-repositories.md` — AC-13, AC-14, AC-15, AC-19,
 * NFR-4). It carries the same security burden as `parseRepoUrl` and one more:
 * an imported URL may only ever SELECT a destination the operator already
 * registered, never introduce one.
 */
const PRIMARY: ForgeInstance = {
  id: 'inst-primary',
  provider: 'gitlab',
  baseUrl: 'https://gitlab.example.com',
  instanceKey: 'gitlab.example.com',
  label: 'Primary',
};

/** An instance mounted under a path prefix — AC-6's shape, and AC-14's trap. */
const PREFIXED: ForgeInstance = {
  id: 'inst-prefixed',
  provider: 'gitlab',
  baseUrl: 'https://git.example.com/gitlab',
  instanceKey: 'git.example.com_gitlab',
  label: 'Behind a prefix',
};

describe('resolveRepoUrl', () => {
  describe('a registered instance, at any namespace depth (AC-13, NFR-4)', () => {
    it('resolves a four-segment namespace and strips the trailing .git', () => {
      const resolved = resolveRepoUrl(
        'https://gitlab.example.com/group/subgroup/team/project.git',
        [PRIMARY],
      );
      expect(resolved).toEqual({
        provider: 'gitlab',
        instanceId: 'inst-primary',
        instanceKey: 'gitlab.example.com',
        // Everything but the last segment is the owner, so the nested groups
        // survive into the clone path instead of being flattened away.
        owner: 'group/subgroup/team',
        name: 'project',
        fullName: 'group/subgroup/team/project',
        namespacePath: 'group/subgroup/team/project',
        cloneUrl: 'https://gitlab.example.com/group/subgroup/team/project.git',
        instance: PRIMARY,
      });
    });

    it('imposes no depth limit of its own (NFR-4)', () => {
      const deep = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'project'];
      const resolved = resolveRepoUrl(
        `https://gitlab.example.com/${deep.join('/')}`,
        [PRIMARY],
      );
      expect(resolved.namespacePath).toBe(deep.join('/'));
      expect(resolved.name).toBe('project');
    });

    it('the shallowest legal namespace still resolves', () => {
      const resolved = resolveRepoUrl('https://gitlab.example.com/acme/api', [PRIMARY]);
      expect(resolved).toMatchObject({
        owner: 'acme',
        name: 'api',
        namespacePath: 'acme/api',
        fullName: 'acme/api',
      });
    });
  });

  describe('an origin that matches nothing is refused, and the refusal is usable (AC-14)', () => {
    it('names every registered instance, and github.com, in the message', () => {
      const second: ForgeInstance = {
        id: 'inst-second',
        provider: 'gitlab',
        baseUrl: 'https://git.acme.io:8443/gitlab',
        instanceKey: 'git.acme.io_8443_gitlab',
        label: 'Self-managed',
      };

      let message = '';
      try {
        resolveRepoUrl('https://gitlab.unregistered.test/acme/api', [PRIMARY, second]);
        throw new Error('resolveRepoUrl should have refused an unregistered origin');
      } catch (err) {
        message = (err as Error).message;
      }

      // The whole point of AC-14: a user staring at this message can see what
      // they could have typed instead.
      expect(message).toContain('https://gitlab.example.com');
      expect(message).toContain('https://git.acme.io:8443/gitlab');
      expect(message).toContain('https://github.com');
    });

    it('with no instances registered, the message still offers github.com', () => {
      expect(() => resolveRepoUrl('https://gitlab.example.com/acme/api', [])).toThrow(
        /https:\/\/github\.com/,
      );
    });
  });

  describe('matching is on origin AND path prefix, not on origin alone (AC-13, AC-14)', () => {
    it('an instance under /gitlab does not swallow a sibling path on the same origin', () => {
      expect(() => resolveRepoUrl('https://git.example.com/other/acme/api', [PREFIXED])).toThrow(
        /does not belong to any registered forge/,
      );
    });

    it('a URL that starts with the prefix as a SUBSTRING is not a match either', () => {
      // `/gitlab-staging/...` starts with the string `/gitlab` but is a
      // different path; a `startsWith` without the separator would admit it.
      expect(() =>
        resolveRepoUrl('https://git.example.com/gitlab-staging/acme/api', [PREFIXED]),
      ).toThrow(/does not belong to any registered forge/);
    });

    it('the same origin with the right prefix resolves, and the prefix is not part of the namespace', () => {
      const resolved = resolveRepoUrl('https://git.example.com/gitlab/acme/api', [PREFIXED]);
      expect(resolved).toMatchObject({
        instanceId: 'inst-prefixed',
        instanceKey: 'git.example.com_gitlab',
        namespacePath: 'acme/api',
        cloneUrl: 'https://git.example.com/gitlab/acme/api.git',
      });
    });

    it('a different port on the same host is a different origin', () => {
      const ported: ForgeInstance = {
        ...PRIMARY,
        id: 'inst-ported',
        baseUrl: 'https://gitlab.example.com:8443',
        instanceKey: 'gitlab.example.com_8443',
      };
      expect(() => resolveRepoUrl('https://gitlab.example.com/acme/api', [ported])).toThrow();
      expect(resolveRepoUrl('https://gitlab.example.com:8443/acme/api', [ported])).toMatchObject({
        instanceId: 'inst-ported',
      });
    });

    it('when two instances share an origin, the deeper prefix wins', () => {
      const root: ForgeInstance = {
        id: 'inst-root',
        provider: 'gitlab',
        baseUrl: 'https://git.example.com',
        instanceKey: 'git.example.com',
        label: 'Root',
      };
      expect(resolveRepoUrl('https://git.example.com/gitlab/acme/api', [root, PREFIXED])).toMatchObject(
        { instanceId: 'inst-prefixed', namespacePath: 'acme/api' },
      );
      expect(resolveRepoUrl('https://git.example.com/other/api', [root, PREFIXED])).toMatchObject({
        instanceId: 'inst-root',
        namespacePath: 'other/api',
      });
    });
  });

  describe('the github.com branch is byte-identical to what shipped (AC-15, AC-19, AC-27)', () => {
    // Every URL the pre-SPEC-06 suite above accepts, resolved with instances
    // registered — the configuration a mixed workspace is actually in.
    const accepted = [
      'https://github.com/acme/widgets',
      'https://github.com/acme/widgets.git',
      'https://github.com/acme/widgets/',
      'http://github.com/acme/widgets',
      '  https://github.com/acme/widgets  ',
      'git@github.com:acme/widgets.git',
      'git@github.com:acme/widgets',
      'https://github.com/acme/widgets.js',
    ];
    for (const url of accepted) {
      it(`still delegates to parseRepoUrl: ${url.trim()}`, () => {
        const resolved = resolveRepoUrl(url, [PRIMARY, PREFIXED]);
        const { owner, name } = parseRepoUrl(url);
        expect({ owner: resolved.owner, name: resolved.name }).toEqual({ owner, name });
        expect(resolved).toMatchObject({
          provider: 'github',
          instanceId: null,
          instanceKey: 'github.com',
          fullName: `${owner}/${name}`,
          namespacePath: `${owner}/${name}`,
          instance: null,
          // Unchanged from today: the string the user supplied is the string
          // that is cloned, which is what keeps the ssh form working.
          cloneUrl: url.trim(),
        });
      });
    }

    const hostile = [
      'https://attacker.test/github.com/acme/widgets',
      'https://github.com@attacker.test/acme/widgets',
      'https://github.com.attacker.test/acme/widgets',
      'https://notgithub.com/acme/widgets',
      'git@attacker.test:acme/widgets.git',
      'https://github.com/acme',
      'https://github.com/acme/widgets/extra',
    ];
    for (const url of hostile) {
      it(`still refuses: ${url}`, () => {
        expect(() => resolveRepoUrl(url, [PRIMARY, PREFIXED])).toThrow();
      });
    }

    it('a registered instance cannot make a github.com URL take the instance branch', () => {
      // A hostile registration naming github.com as its base URL must not
      // capture GitHub imports — the github.com branch is checked first.
      const impostor: ForgeInstance = {
        id: 'inst-impostor',
        provider: 'gitlab',
        baseUrl: 'https://github.com',
        instanceKey: 'github.com',
        label: 'Impostor',
      };
      expect(resolveRepoUrl('https://github.com/acme/widgets', [impostor])).toMatchObject({
        provider: 'github',
        instanceId: null,
        instance: null,
      });
    });
  });
});

/**
 * `toRepoDto` — the fields AC-15 promises on EVERY repository, including the
 * ones imported before this feature existed (AC-19, AC-27).
 */
function repoRow(over: Partial<typeof t.repos.$inferSelect> = {}): typeof t.repos.$inferSelect {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: '/clones/acme/widgets',
    contextRoots: null,
    provider: 'github',
    instanceId: null,
    instanceKey: 'github.com',
    namespacePath: '',
    lastPolledAt: null,
    lastSyncError: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('toRepoDto', () => {
  it('a pre-feature row (null instance_id, empty namespace_path) reports as github.com (AC-19, AC-27)', () => {
    expect(toRepoDto(repoRow())).toEqual({
      id: 'repo-1',
      workspace_id: 'ws-1',
      owner: 'acme',
      name: 'widgets',
      full_name: 'acme/widgets',
      default_branch: 'main',
      clone_path: '/clones/acme/widgets',
      last_polled_at: null,
      created_by: 'user-1',
      provider: 'github',
      instance_id: null,
      // The column is still `''` in the row above: the fallback is derived at
      // read time, because a backfilling UPDATE is what AC-19 rules out.
      namespace_path: 'acme/widgets',
      instance_label: 'github.com',
      web_url: 'https://github.com/acme/widgets',
      // AC-44: always present; `null` = the last sync attempt did not fail.
      last_sync_error: null,
    });
  });

  it('owner/name/full_name are untouched for a GitHub row (AC-27)', () => {
    const dto = toRepoDto(repoRow({ owner: 'acme', name: 'widgets.js', fullName: 'acme/widgets.js' }));
    expect(dto.owner).toBe('acme');
    expect(dto.name).toBe('widgets.js');
    expect(dto.full_name).toBe('acme/widgets.js');
    expect(dto.web_url).toBe('https://github.com/acme/widgets.js');
  });

  it('an instance-owned row reports that instance and links to it (AC-15, AC-29)', () => {
    const dto = toRepoDto(
      repoRow({
        owner: 'group/subgroup',
        name: 'project',
        fullName: 'group/subgroup/project',
        provider: 'gitlab',
        instanceId: 'inst-prefixed',
        instanceKey: 'git.example.com_gitlab',
        namespacePath: 'group/subgroup/project',
        clonePath: '/clones/git.example.com_gitlab/group/subgroup/project',
      }),
      PREFIXED,
    );
    expect(dto).toMatchObject({
      provider: 'gitlab',
      instance_id: 'inst-prefixed',
      namespace_path: 'group/subgroup/project',
      instance_label: 'Behind a prefix',
      // Built from the owning instance's base URL, prefix and all.
      web_url: 'https://git.example.com/gitlab/group/subgroup/project',
    });
  });
});
