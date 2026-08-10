/**
 * The resolution layer: flat names → UUIDs, and the argument validation that
 * runs before any URL is built.
 */
import { describe, expect, it } from 'vitest';

import { InvalidArgument, NotFound, Resolver, validatePr, validateRepo } from '../src/resolve.js';
import { stubApi } from './helpers/stub-api.js';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const PR_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

const repos = [{ id: REPO_ID, full_name: 'acme/widgets' }];
const pulls = [{ id: PR_ID, number: 42 }];
const agents = [{ id: AGENT_ID, name: 'General Reviewer', model: 'claude-opus-5', enabled: true }];

describe('argument validation', () => {
  it('accepts owner/name and rejects anything else', () => {
    expect(validateRepo('acme/widgets')).toBe('acme/widgets');
    for (const bad of ['acme', 'acme/widgets/extra', '../etc/passwd', 'acme/wid gets', '', 42]) {
      expect(() => validateRepo(bad), String(bad)).toThrow(InvalidArgument);
    }
  });

  it('rejects a pr that is not a whole number in range', () => {
    expect(validatePr(42)).toBe(42);
    for (const bad of ['42', 4.2, 0, -1, 10_000_001, null]) {
      expect(() => validatePr(bad), String(bad)).toThrow(InvalidArgument);
    }
  });
});

describe('Resolver', () => {
  it('resolves a repo, a pull and an agent', async () => {
    const api = stubApi({
      'GET /repos': repos,
      [`GET /repos/${REPO_ID}/pulls`]: pulls,
      'GET /agents': agents,
    });
    const resolver = new Resolver(api);

    expect(await resolver.resolveRepoId('acme/widgets')).toBe(REPO_ID);
    expect(await resolver.resolvePullId(REPO_ID, 42)).toBe(PR_ID);
    expect(await resolver.resolveAgentId('general reviewer')).toBe(AGENT_ID);
  });

  it('reports an unknown repo as a miss, not a crash', async () => {
    const resolver = new Resolver(stubApi({ 'GET /repos': repos }));
    await expect(resolver.resolveRepoId('acme/nope')).rejects.toBeInstanceOf(NotFound);
  });

  it('reports an unknown agent as a miss', async () => {
    const resolver = new Resolver(stubApi({ 'GET /agents': agents }));
    await expect(resolver.resolveAgentId('Nope')).rejects.toBeInstanceOf(NotFound);
  });

  it('treats a PR with a null id as not imported', async () => {
    // `PrMeta.id` is `.nullish()` — a null id means the PR was listed from
    // GitHub but never persisted, which is the not-imported case.
    const api = stubApi({ [`GET /repos/${REPO_ID}/pulls`]: [{ id: null, number: 42 }] });
    const resolver = new Resolver(api);
    await expect(resolver.resolvePullId(REPO_ID, 42)).rejects.toBeInstanceOf(NotFound);
  });

  it('serves a second resolution from cache without a second fetch', async () => {
    const api = stubApi({ 'GET /repos': repos });
    const resolver = new Resolver(api);

    await resolver.resolveRepoId('acme/widgets');
    await resolver.resolveRepoId('ACME/Widgets');

    expect(api.calls).toEqual(['GET /repos']);
  });

  it('refetches exactly once on a miss, so a repo added later resolves', async () => {
    let added = false;
    const api = stubApi({ 'GET /repos': () => (added ? repos : []) });
    const resolver = new Resolver(api);

    await expect(resolver.resolveRepoId('acme/widgets')).rejects.toBeInstanceOf(NotFound);
    added = true;
    expect(await resolver.resolveRepoId('acme/widgets')).toBe(REPO_ID);

    expect(api.calls).toEqual(['GET /repos', 'GET /repos']);
  });
});
