import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, ne } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockForgeClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { GitLabForgeClient } from '../src/adapters/gitlab/forge.js';
import { ConfigError } from '../src/platform/errors.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { instanceSecretKey } from '../src/modules/instances/constants.js';

/**
 * Which forge answers for which repository, and what happens when one cannot
 * (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`, AC-20, AC-42, AC-43,
 * AC-44, AC-45, NFR-7).
 *
 * Ring 4 + ring 5 against a REAL Postgres, because every claim here is a
 * property of rows: `container.forge(repo)` resolves from the repository's
 * `provider`/`instance_id` columns and an instance row it looks up by
 * workspace, `last_polled_at` is a column only a successful sync writes, and
 * AC-43's isolation is two repositories' columns diverging. None of that is
 * observable without the database (`backend-onion-architecture` §9).
 *
 * `*.it.test.ts` is the CI split, and a skipping suite exits 0 and reads as
 * passing — the run's COUNT is the evidence, never the exit code
 * (`server/INSIGHTS.md` 2026-08-02, 2026-08-03; run the lane with
 * `--no-file-parallelism`).
 *
 * `MockForgeClient` branches on `RepoRef.instanceKey` on purpose. Two
 * repositories on two instances must be able to answer DIFFERENTLY, and a mock
 * that ignored the key would make AC-43's isolation test compare one value with
 * itself and pass either way (`server/INSIGHTS.md` 2026-08-29).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Seeded by `seed()`; never touched by this file's wipe. */
const SEEDED_REPO = 'acme/payments-api';

/** The fixture access token. Nothing this file produces may contain it. */
const CREDENTIAL = 'glpat-FIXTURE-do-not-echo-0000';

/** What a GitLab list answer really looks like: no line counts (AC-20). */
const listedMr = (over: Partial<PrMeta> = {}): PrMeta => ({
  number: 7,
  title: 'Add rate limiting to the public API',
  author: 'marisa.koch',
  branch: 'feat/rate-limit',
  base: 'main',
  head_sha: 'head-bbb',
  // Zero on the list payload for BOTH providers — the route backfills them.
  additions: 0,
  deletions: 0,
  files_count: 0,
  status: 'open',
  opened_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T03:00:00.000Z',
  ...over,
});

d('forge resolution and per-repository sync isolation (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let secrets: MockSecretsProvider;
  let instanceSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    const { db } = pg.handle;
    // Repos first: `repos.instance_id` is ON DELETE RESTRICT by design.
    await db.delete(t.repos).where(ne(t.repos.fullName, SEEDED_REPO));
    await db.delete(t.gitInstances);
    secrets = new MockSecretsProvider();
  });

  const makeApp = async (overrides: ContainerOverrides): Promise<FastifyInstance> =>
    buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides,
    });

  /** Register an instance the way Stage A's route would, without the network. */
  async function registerInstance(label: string, opts: { withCredential?: boolean } = {}) {
    const host = `gitlab-${instanceSeq++}.example.com`;
    const [row] = await pg.handle.db
      .insert(t.gitInstances)
      .values({
        workspaceId,
        provider: 'gitlab',
        baseUrl: `https://${host}`,
        instanceKey: host,
        label,
        version: '17.4.1',
        edition: 'community',
        approvalCapability: 'unknown',
        verifiedAt: new Date(),
      })
      .returning();
    if (opts.withCredential !== false) {
      // Through the provider only — never a column, never a response (AC-10).
      await secrets.set(instanceSecretKey(row!.id), CREDENTIAL);
    }
    return row!;
  }

  async function addRepo(values: Partial<typeof t.repos.$inferInsert> & { name: string }) {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        fullName: `acme/${values.name}`,
        ...values,
      })
      .returning();
    return row!;
  }

  async function addPr(repoId: string, over: Partial<typeof t.pullRequests.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 7,
        title: 'Persisted snapshot',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'head-bbb',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'open',
        ...over,
      })
      .returning();
    return row!;
  }

  const repoRow = async (id: string) => {
    const [row] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, id));
    return row!;
  };

  // -------------------------------------------------------------------------
  // container.forge(repo) — the repository row decides the implementation
  // -------------------------------------------------------------------------

  it('resolves GitHub for a github.com repository and GitLab for an instance-backed one', async () => {
    const instance = await registerInstance('Acme GitLab');
    const github = new MockGitHubClient();
    const app = await makeApp({ github, secrets });

    const legacy = await addRepo({ name: 'widgets' });
    const hosted = await addRepo({
      name: 'api',
      provider: 'gitlab',
      instanceId: instance.id,
      instanceKey: instance.instanceKey,
      namespacePath: 'acme/api',
    });

    // The pre-feature row's columns take their DEFAULTs, and those defaults are
    // what keep every existing repository on the GitHub client with no
    // re-import (AC-19).
    expect(legacy).toMatchObject({ provider: 'github', instanceId: null });
    expect(await app.container.forge(legacy)).toBe(github);

    // The instance-backed row resolves to the GitLab implementation instead.
    // No caller anywhere branches on a provider — the row does it here, once.
    const forge = await app.container.forge(hosted);
    expect(forge).toBeInstanceOf(GitLabForgeClient);
    expect(forge).not.toBe(github);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-45 — a missing credential is a NORMAL path, not a 500
  // -------------------------------------------------------------------------

  it('AC-45: a missing instance credential throws ConfigError naming the instance', async () => {
    const instance = await registerInstance('Acme GitLab', { withCredential: false });
    const app = await makeApp({ github: new MockGitHubClient(), secrets });
    const repo = await addRepo({
      name: 'api',
      provider: 'gitlab',
      instanceId: instance.id,
      instanceKey: instance.instanceKey,
      namespacePath: 'acme/api',
    });

    const err = await app.container.forge(repo).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(ConfigError);
    // Names ONE instance, so an operator with several knows which credential to
    // fix (AC-45) — and never the secret key or its value (AC-10).
    expect(err.message).toContain('Acme GitLab');
    expect(err.message).not.toContain(CREDENTIAL);
    expect(err.message).not.toContain(instanceSecretKey(instance.id));

    await app.close();
  });

  it('AC-45/NFR-7: a repository with no credential still READS, and only writing refuses', async () => {
    const instance = await registerInstance('Acme GitLab', { withCredential: false });
    const app = await makeApp({ github: new MockGitHubClient(), secrets });
    const repo = await addRepo({
      name: 'api',
      provider: 'gitlab',
      instanceId: instance.id,
      instanceKey: instance.instanceKey,
      namespacePath: 'acme/api',
    });
    const pr = await addPr(repo.id);

    // The list is local-first: the resolver's ConfigError is caught and the
    // persisted snapshot is served. A 500 here would take the whole screen out
    // over a missing token.
    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { number: number }[]).map((p) => p.number)).toEqual([7]);

    // Inline comments are fetched live, so there is nothing to serve — an empty
    // list, still not an error.
    const comments = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/comments` });
    expect(comments.statusCode).toBe(200);
    expect(comments.json()).toEqual([]);

    // Posting is the one action that cannot degrade, and it refuses with the
    // resolver's own message rather than a 500.
    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'nope' },
    });
    expect(posted.statusCode).toBe(400);
    expect(JSON.stringify(posted.json())).toContain('Acme GitLab');
    expect(JSON.stringify(posted.json())).not.toContain(CREDENTIAL);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-43 — one instance offline leaves the others syncing
  // -------------------------------------------------------------------------

  it('AC-43: one instance offline does not stop another instance’s repository syncing', async () => {
    const down = await registerInstance('Offline GitLab');
    const up = await registerInstance('Healthy GitLab');

    const forge = new MockForgeClient({
      byInstanceKey: {
        [down.instanceKey]: { offline: 'connect ETIMEDOUT 203.0.113.10:443' },
        [up.instanceKey]: { pulls: [listedMr()] },
      },
    });
    const app = await makeApp({ forge, secrets });

    const downRepo = await addRepo({
      name: 'down-api',
      provider: 'gitlab',
      instanceId: down.id,
      instanceKey: down.instanceKey,
      namespacePath: 'acme/down-api',
    });
    const upRepo = await addRepo({
      name: 'up-api',
      provider: 'gitlab',
      instanceId: up.id,
      instanceKey: up.instanceKey,
      namespacePath: 'acme/up-api',
    });

    // The failing repository goes FIRST: if one repository's failure aborted
    // the cycle, the healthy one below would never be attempted.
    const failed = await app.inject({ method: 'POST', url: `/repos/${downRepo.id}/poll` });
    const ok = await app.inject({ method: 'POST', url: `/repos/${upRepo.id}/poll` });

    expect(failed.statusCode).toBe(200);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ synced: 1, reviewTriggered: false, sync_error: null });

    // Both were genuinely attempted against their OWN instance — the evidence
    // that the second call was not skipped by the first one's failure.
    expect(forge.calls.map((c) => c.repo.instanceKey)).toEqual([
      down.instanceKey,
      up.instanceKey,
    ]);

    // AC-42/AC-43: the healthy repository's clock advanced…
    expect((await repoRow(upRepo.id)).lastPolledAt).not.toBeNull();
    // …and the offline one's did NOT, so "when did this last actually sync"
    // stays a true answer rather than a timestamp for an attempt that failed.
    expect((await repoRow(downRepo.id)).lastPolledAt).toBeNull();

    // And the failure did not write the healthy instance's merge requests onto
    // the offline instance's repository.
    const synced = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, downRepo.id));
    expect(synced).toEqual([]);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-44 / NFR-7 — a failed sync is distinguishable from an empty one
  // -------------------------------------------------------------------------

  it('AC-44/NFR-7: a failed sync reports sync_error, an empty one reports null', async () => {
    const down = await registerInstance('Offline GitLab');
    const empty = await registerInstance('Quiet GitLab');

    const forge = new MockForgeClient({
      byInstanceKey: {
        [down.instanceKey]: { offline: 'connect ETIMEDOUT 203.0.113.10:443' },
        // A project that genuinely has no open merge requests.
        [empty.instanceKey]: { pulls: [] },
      },
    });
    const app = await makeApp({ forge, secrets });

    const downRepo = await addRepo({
      name: 'down-api',
      provider: 'gitlab',
      instanceId: down.id,
      instanceKey: down.instanceKey,
      namespacePath: 'acme/down-api',
    });
    const emptyRepo = await addRepo({
      name: 'quiet-api',
      provider: 'gitlab',
      instanceId: empty.id,
      instanceKey: empty.instanceKey,
      namespacePath: 'acme/quiet-api',
    });

    const failed = (await app.inject({ method: 'POST', url: `/repos/${downRepo.id}/poll` })).json();
    const quiet = (await app.inject({ method: 'POST', url: `/repos/${emptyRepo.id}/poll` })).json();

    // Both synced zero change requests. The COUNT cannot tell the two apart,
    // which is exactly why AC-44 needs a second field: without it a stale
    // snapshot and a genuinely empty project render identically.
    expect(failed.synced).toBe(0);
    expect(quiet.synced).toBe(0);

    expect(typeof failed.sync_error).toBe('string');
    expect(failed.sync_error.length).toBeGreaterThan(0);
    expect(quiet.sync_error).toBeNull();

    // The key is always present, so "still loading" (no response yet) is a
    // third, distinct state on the client rather than an absent field.
    expect(Object.keys(quiet)).toContain('sync_error');

    // NFR-7: the failure left the repository's own freshness untouched, so the
    // list it serves is honestly labelled as of its last SUCCESSFUL sync.
    expect((await repoRow(downRepo.id)).lastPolledAt).toBeNull();

    await app.close();
  });

  it('NFR-7: a forge failure serves the persisted snapshot rather than failing the read', async () => {
    const down = await registerInstance('Offline GitLab');
    const forge = new MockForgeClient({
      byInstanceKey: { [down.instanceKey]: { offline: 'connect ETIMEDOUT 203.0.113.10:443' } },
    });
    const app = await makeApp({ forge, secrets });

    const repo = await addRepo({
      name: 'down-api',
      provider: 'gitlab',
      instanceId: down.id,
      instanceKey: down.instanceKey,
      namespacePath: 'acme/down-api',
    });
    await addPr(repo.id, { title: 'Written by the last successful sync' });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { number: number; title: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.title).toBe('Written by the last successful sync');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-20 — the list, and where its line counts actually come from
  // -------------------------------------------------------------------------

  it('AC-20: a GitLab repository’s list carries every field, with counts filled by the backfill', async () => {
    const instance = await registerInstance('Acme GitLab');
    const forge = new MockForgeClient({
      byInstanceKey: {
        [instance.instanceKey]: {
          // As the real adapter emits it: no line counts on the list payload.
          pulls: [listedMr()],
          // The detail endpoint is where they exist, for both providers.
          detail: { additions: 247, deletions: 38, files_count: 9 },
        },
      },
    });
    const app = await makeApp({ forge, secrets });

    const repo = await addRepo({
      name: 'api',
      provider: 'gitlab',
      instanceId: instance.id,
      instanceKey: instance.instanceKey,
      namespacePath: 'acme/api',
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(res.statusCode).toBe(200);

    const [row] = res.json() as Record<string, unknown>[];
    expect(row).toMatchObject({
      number: 7,
      title: 'Add rate limiting to the public API',
      author: 'marisa.koch',
      branch: 'feat/rate-limit',
      base: 'main',
      head_sha: 'head-bbb',
      // The change-request list shows the SAME fields it shows for GitHub, and
      // these three are zero on the list payload of either provider — the
      // BACKFILL_LIMIT loop in `pulls/routes.ts` is what populates them, so
      // this is the only place the enrichment can be observed.
      additions: 247,
      deletions: 38,
      files_count: 9,
      // Never reviewed, and the merge request is open.
      status: 'needs_review',
      opened_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T03:00:00.000Z',
    });

    // The backfill is PERSISTED, not computed per response — a second read must
    // not need a second detail fetch.
    const [stored] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));
    expect(stored).toMatchObject({ additions: 247, deletions: 38, filesCount: 9, status: 'open' });

    // Both calls went to this repository's own instance, via the forge.
    expect(forge.calls.map((c) => c.method)).toEqual(['listPullRequests', 'getPullRequest']);
    expect(new Set(forge.calls.map((c) => c.repo.instanceKey))).toEqual(
      new Set([instance.instanceKey]),
    );

    await app.close();
  });
});
