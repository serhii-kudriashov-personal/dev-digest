import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, ne } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloneOptions, RepoRef } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

/**
 * Repository identity across instances (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-16, AC-17, AC-19, AC-27,
 * AC-42, NFR-9).
 *
 * Ring 5 + ring 3 against a REAL Postgres, because every claim here is a
 * property of SQL: the unique index is `(workspace_id, instance_key,
 * full_name)`, the new columns' NOT NULL DEFAULTs are what make a pre-feature
 * row keep working with no DML, and NFR-9 is `onConflictDoNothing()` losing a
 * race. A mock DB would assert none of it (`backend-onion-architecture` §9).
 *
 * `*.it.test.ts` is the CI split. A skipping suite exits 0 and reads as
 * passing, so the run's COUNT is the evidence, never the exit code
 * (`server/INSIGHTS.md` 2026-08-02, 2026-08-03).
 *
 * The clone is stubbed at the I/O boundary ONLY: `clonePathFor` is the real
 * `SimpleGitClient` implementation, so the clone locations asserted below are
 * production's own derivation rather than the test's.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Seeded by `seed()`; never touched by this file's wipe. */
const SEEDED_REPO = 'acme/payments-api';

class StubGit extends SimpleGitClient {
  public cloned: { repo: RepoRef; url: string }[] = [];
  override async clone(repo: RepoRef, url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    // The real path derivation, no network: the destination is exactly where
    // production would have put the clone.
    const path = this.clonePathFor(repo);
    this.cloned.push({ repo, url });
    return { path };
  }
}

d('repository identity per instance (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneRoot: string;
  let git: StubGit;
  let secrets: MockSecretsProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
    cloneRoot = await mkdtemp(join(tmpdir(), 'dd-repos-inst-'));
  });

  afterAll(async () => {
    await rm(cloneRoot, { recursive: true, force: true });
    await pg?.stop();
  });

  beforeEach(async () => {
    const { db } = pg.handle;
    // Repos first: `repos.instance_id` is ON DELETE RESTRICT by design.
    await db.delete(t.repos).where(ne(t.repos.fullName, SEEDED_REPO));
    await db.delete(t.gitInstances);
    git = new StubGit(cloneRoot);
    secrets = new MockSecretsProvider();
  });

  const makeApp = async (): Promise<FastifyInstance> =>
    buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { git, secrets, github: new MockGitHubClient() },
    });

  /** Register an instance the way Stage A's route would, without the network. */
  const registerInstance = async (baseUrl: string, instanceKey: string, label: string) => {
    const [row] = await pg.handle.db
      .insert(t.gitInstances)
      .values({
        workspaceId,
        provider: 'gitlab',
        baseUrl,
        instanceKey,
        label,
        version: '17.4.1',
        edition: 'community',
        approvalCapability: 'unknown',
        verifiedAt: new Date(),
      })
      .returning();
    return row!;
  };

  const importRepo = (app: FastifyInstance, url: string) =>
    app.inject({ method: 'POST', url: '/repos', payload: { url } });

  const listRepos = async (app: FastifyInstance) => {
    const res = await app.inject({ method: 'GET', url: '/repos' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { full_name: string }[]).filter((r) => r.full_name !== SEEDED_REPO);
  };

  const byFullName = <T extends { full_name: string }>(rows: T[]): Record<string, T> =>
    Object.fromEntries(rows.map((r) => [r.full_name, r]));

  // -------------------------------------------------------------------------
  // AC-16 / AC-17 — one namespace path, two instances
  // -------------------------------------------------------------------------

  it('AC-16/AC-17: the same namespace path from two instances is two rows with two clone paths', async () => {
    const one = await registerInstance('https://gitlab.one.example.com', 'gitlab.one.example.com', 'One');
    const two = await registerInstance('https://git.acme.io:8443/gitlab', 'git.acme.io_8443_gitlab', 'Two');
    const app = await makeApp();

    const first = await importRepo(app, 'https://gitlab.one.example.com/acme/api');
    const second = await importRepo(app, 'https://git.acme.io:8443/gitlab/acme/api');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).not.toBe(second.json().id);

    await app.container.jobs.onIdle();

    // Two rows sharing one `full_name`: that column alone can no longer
    // identify a repository, which is the whole reason the unique index gained
    // `instance_key`.
    const rows = (await listRepos(app)) as unknown as {
      id: string;
      full_name: string;
      clone_path: string | null;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.full_name)).toEqual(['acme/api', 'acme/api']);

    // AC-17: distinct locations, each under its own instance's key. Sharing one
    // would review the other instance's code and then `reset --hard` over it.
    const paths = rows.map((r) => r.clone_path);
    expect(new Set(paths).size).toBe(2);
    expect(paths).toContain(`${cloneRoot}/gitlab.one.example.com/acme/api`);
    expect(paths).toContain(`${cloneRoot}/git.acme.io_8443_gitlab/acme/api`);

    // Each was cloned from its OWN instance, credential-free.
    expect(git.cloned.map((c) => c.url).sort()).toEqual([
      'https://git.acme.io:8443/gitlab/acme/api.git',
      'https://gitlab.one.example.com/acme/api.git',
    ]);

    // AC-15: every row reports its instance, with the label and link of that
    // instance rather than of the other one.
    const dtos = (await listRepos(app)) as unknown as {
      instance_id: string;
      instance_label: string;
      web_url: string;
      provider: string;
      namespace_path: string;
    }[];
    const byInstance = Object.fromEntries(dtos.map((r) => [r.instance_id, r]));
    expect(byInstance[one.id]).toMatchObject({
      provider: 'gitlab',
      instance_label: 'One',
      namespace_path: 'acme/api',
      web_url: 'https://gitlab.one.example.com/acme/api',
    });
    expect(byInstance[two.id]).toMatchObject({
      provider: 'gitlab',
      instance_label: 'Two',
      web_url: 'https://git.acme.io:8443/gitlab/acme/api',
    });

    await app.close();
  });

  it('AC-16: importing the same URL twice from ONE instance stays one row', async () => {
    await registerInstance('https://gitlab.one.example.com', 'gitlab.one.example.com', 'One');
    const app = await makeApp();

    const first = await importRepo(app, 'https://gitlab.one.example.com/acme/api');
    const again = await importRepo(app, 'https://gitlab.one.example.com/acme/api.git');
    expect(first.statusCode).toBe(201);
    // The second import is the existing row, not a conflict and not a 500.
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);

    await app.container.jobs.onIdle();
    expect(await listRepos(app)).toHaveLength(1);
    // And it did not enqueue a second clone of the same destination.
    expect(git.cloned).toHaveLength(1);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-19 / AC-27 — a repository imported before this feature existed
  // -------------------------------------------------------------------------

  it('AC-19/AC-27: a pre-feature row lists, syncs and reports github with no re-import', async () => {
    const { db } = pg.handle;
    const legacyPath = git.clonePathFor({ owner: 'legacy', name: 'widgets' });
    // Exactly what a row inserted before this feature looks like: the four new
    // columns take their DEFAULTs and nothing else is supplied.
    const [row] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'legacy',
        name: 'widgets',
        fullName: 'legacy/widgets',
        clonePath: legacyPath,
      })
      .returning();

    // The defaults ARE the back-compat mechanism — assert them at the column,
    // because a DML backfill is what AC-19 forbids.
    expect(row).toMatchObject({
      provider: 'github',
      instanceId: null,
      instanceKey: 'github.com',
      namespacePath: '',
    });

    const app = await makeApp();

    // 1. It is listed, and it reports GitHub.
    const listed = byFullName(await listRepos(app));
    expect(listed['legacy/widgets']).toMatchObject({
      id: row!.id,
      provider: 'github',
      instance_id: null,
      instance_label: 'github.com',
      // Derived at read time from `full_name`; the column is still ''.
      namespace_path: 'legacy/widgets',
      web_url: 'https://github.com/legacy/widgets',
      clone_path: legacyPath,
    });

    // 2. It is syncable, and the sync goes to github.com with the legacy layout.
    const refreshed = await app.inject({ method: 'POST', url: `/repos/${row!.id}/refresh` });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toEqual({ status: 'refreshing' });
    await app.container.jobs.onIdle();

    const clone = git.cloned.find((c) => c.repo.name === 'widgets');
    expect(clone).toBeDefined();
    expect(clone!.url).toBe('https://github.com/legacy/widgets.git');
    expect(clone!.repo.instanceKey).toBe('github.com');

    // 3. No re-import: same row, same id, same clone path, still one row.
    const after = byFullName(await listRepos(app));
    expect(Object.keys(after)).toEqual(['legacy/widgets']);
    expect(after['legacy/widgets']!).toMatchObject({ id: row!.id, clone_path: legacyPath });

    // 4. Nothing rewrote the row's identity columns behind the user's back.
    const [stored] = await db.select().from(t.repos).where(eq(t.repos.id, row!.id));
    expect(stored).toMatchObject({
      provider: 'github',
      instanceId: null,
      instanceKey: 'github.com',
      namespacePath: '',
      clonePath: legacyPath,
    });

    await app.close();
  });

  it('AC-19: a GitHub import still lands on the legacy clone layout alongside a registered instance', async () => {
    await registerInstance('https://gitlab.one.example.com', 'gitlab.one.example.com', 'One');
    const app = await makeApp();

    const created = await importRepo(app, 'https://github.com/acme/widgets');
    expect(created.statusCode).toBe(201);
    await app.container.jobs.onIdle();

    const listed = byFullName(await listRepos(app));
    expect(listed['acme/widgets']).toMatchObject({
      provider: 'github',
      instance_id: null,
      instance_label: 'github.com',
      web_url: 'https://github.com/acme/widgets',
      // No instance segment: every clone already on disk keeps its location.
      clone_path: `${cloneRoot}/acme/widgets`,
    });

    await app.close();
  });

  // -------------------------------------------------------------------------
  // NFR-9 — two simultaneous imports of one URL
  // -------------------------------------------------------------------------

  it('NFR-9: two concurrent POST /repos of one URL yield exactly one row', async () => {
    await registerInstance('https://gitlab.one.example.com', 'gitlab.one.example.com', 'One');
    const app = await makeApp();

    const url = 'https://gitlab.one.example.com/acme/concurrent';
    const [a, b] = await Promise.all([importRepo(app, url), importRepo(app, url)]);

    // Both requests succeed — the loser of the race gets the winner's row, not
    // a 500 from the unique violation.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().id).toBe(b.json().id);

    await app.container.jobs.onIdle();

    const rows = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/concurrent'));
    expect(rows).toHaveLength(1);
    // And at most one clone was enqueued for it (NFR-9: "no partial second
    // clone left on disk").
    expect(git.cloned.filter((c) => c.repo.name === 'concurrent')).toHaveLength(1);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-42 — last successful sync time, per repository
  // -------------------------------------------------------------------------

  it('AC-42: two repositories on two instances carry independent last_polled_at', async () => {
    await registerInstance('https://gitlab.one.example.com', 'gitlab.one.example.com', 'One');
    await registerInstance('https://gitlab.two.example.com', 'gitlab.two.example.com', 'Two');
    const app = await makeApp();

    await importRepo(app, 'https://gitlab.one.example.com/acme/first');
    await importRepo(app, 'https://gitlab.two.example.com/acme/second');
    await app.container.jobs.onIdle();

    const before = byFullName(await listRepos(app)) as Record<
      string,
      { id: string; last_polled_at: string | null }
    >;
    expect(before['acme/first']!.last_polled_at).not.toBeNull();
    expect(before['acme/second']!.last_polled_at).not.toBeNull();

    // Distinguishable clock: the two writes must be orderable.
    await new Promise((r) => setTimeout(r, 25));

    await app.inject({ method: 'POST', url: `/repos/${before['acme/first']!.id}/refresh` });
    await app.container.jobs.onIdle();

    const after = byFullName(await listRepos(app)) as Record<
      string,
      { last_polled_at: string | null }
    >;
    // The synced repository moved…
    expect(Date.parse(after['acme/first']!.last_polled_at!)).toBeGreaterThan(
      Date.parse(before['acme/first']!.last_polled_at!),
    );
    // …and the one on the other instance did not. A sync bump that is not
    // scoped to one row would drag every repository's freshness with it.
    expect(after['acme/second']!.last_polled_at).toBe(before['acme/second']!.last_polled_at);

    await app.close();
  });
});
