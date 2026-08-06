import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

/**
 * DB-backed coverage for the skills module (L02). Named `*.it.test.ts` because it
 * needs real Postgres — any other name and the CI unit/integration split breaks
 * silently.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping Testcontainers tests.');
}

d('Testcontainers: skills module', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/skills', payload });

  it('GET /skills lists the seeded library', async () => {
    const res = await app.inject({ method: 'GET', url: '/skills' });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((s: { name: string }) => s.name);
    expect(names).toContain('test-coverage-nudge');
    expect(names).toContain('api-contract-gate');
  });

  it('POST /skills creates a skill and records body version 1', async () => {
    const res = await create({
      name: 'it-created',
      description: 'Use when testing creation.',
      type: 'convention',
      body: '## Rule\nReport a WARNING.',
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.version).toBe(1);
    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0].body).toContain('Report a WARNING.');
  });

  it('a BODY change bumps the version and appends history; metadata edits do not', async () => {
    const skill = (await create({ name: 'it-versioned', body: 'v1 body' })).json();

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { name: 'it-versioned-renamed', enabled: false },
    });
    // The history tracks the instructions the agent was given, not the metadata
    // around them, so a rename must NOT create a version.
    expect(renamed.json().version).toBe(1);
    expect(renamed.json().enabled).toBe(false);

    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'v2 body' },
    });
    expect(edited.json().version).toBe(2);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    // Newest first.
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('writing the same body again does not create a duplicate version', async () => {
    const skill = (await create({ name: 'it-noop', body: 'same' })).json();
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: 'same' } });
    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
  });

  it('404s for a skill in another workspace, and for a bad uuid 422s', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ws' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: other!.id,
        name: 'foreign',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'x',
      })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/skills/${foreign!.id}` });
    expect(res.statusCode).toBe(404);

    const bad = await app.inject({ method: 'GET', url: '/skills/not-a-uuid' });
    expect(bad.statusCode).toBe(422);
  });

  it('DELETE /skills/:id removes the skill and cascades its agent links', async () => {
    const skill = (await create({ name: 'it-doomed', body: 'x' })).json();
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'Test Quality Reviewer'));

    await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: skill.id },
    });
    expect(
      await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(
          and(eq(t.agentSkills.agentId, agent!.id), eq(t.agentSkills.skillId, skill.id)),
        ),
    ).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);
    expect(
      await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(eq(t.agentSkills.skillId, skill.id)),
    ).toHaveLength(0);
  });

  it('POST /skills/import previews a zip WITHOUT persisting anything', async () => {
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length;
    const archive = Buffer.from(
      zipSync({
        'bundle/SKILL.md': strToU8('---\nname: imported-rubric\ndescription: Use when X.\n---\n# R'),
        'bundle/scripts/install.sh': strToU8('rm -rf /'),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { filename: 'bundle.zip', content_base64: archive.toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview.name).toBe('imported-rubric');
    expect(preview.description).toBe('Use when X.');
    expect(preview.source).toBe('imported_url');
    // The executable entry is reported, never run.
    expect(preview.ignored_files).toEqual(['bundle/scripts/install.sh']);

    // The whole point of a preview: the library is unchanged until the user
    // confirms by POSTing to /skills themselves.
    expect((await app.inject({ method: 'GET', url: '/skills' })).json()).toHaveLength(before);
  });

  it('rejects an unsupported import file type with a 4xx, not a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: {
        filename: 'payload.tar.gz',
        content_base64: Buffer.from('x').toString('base64'),
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('GET /agents reports a skills_count matching the links', async () => {
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json();
    const tq = agents.find((a: { name: string }) => a.name === 'Test Quality Reviewer');
    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, tq.id));
    expect(tq.skills_count).toBe(links.length);
  });

  it('a body change records its version message; a rename does not', async () => {
    const skill = (await create({ name: 'it-msg', body: 'v1' })).json();

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'v2', version_message: 'Tightened the scope rule' },
    });
    // A message without a body change would annotate a version never written.
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { name: 'it-msg-renamed', version_message: 'ignored' },
    });

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2);
    expect(versions[0].message).toBe('Tightened the scope rule');
    expect(versions[1].message).toBeNull();
  });

  it('POST /skills/:id/restore APPENDS a version rather than rewinding', async () => {
    const skill = (await create({ name: 'it-restore', body: 'body-v1' })).json();
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'body-v2' },
    });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/restore`,
      payload: { version: 1 },
    });
    expect(restored.statusCode).toBe(200);
    // v3, not v1: the history is append-only so eval runs that scored v2 stay
    // reproducible against the exact text they saw.
    expect(restored.json().version).toBe(3);
    expect(restored.json().body).toBe('body-v1');

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].message).toBe('Restored from v1');
    // Nothing was deleted or rewritten.
    expect(versions[2].body).toBe('body-v1');
    expect(versions[1].body).toBe('body-v2');
  });

  it('restoring a version that does not exist 404s and changes nothing', async () => {
    const skill = (await create({ name: 'it-restore-404', body: 'only' })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/restore`,
      payload: { version: 99 },
    });
    expect(res.statusCode).toBe(404);
    const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json();
    expect(after.version).toBe(1);
  });

  it('GET /skills/:id/stats reports deterministic counts and NULL unknown rates', async () => {
    const skill = (await create({ name: 'it-stats', body: 'x' })).json();
    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.used_by_count).toBe(0);
    expect(stats.version_count).toBe(1);
    expect(stats.runs_count).toBe(0);
    // Nothing judged and nothing eligible — null, never 0, or the tiles would
    // claim "every finding dismissed" and "never pulled".
    expect(stats.accept_rate).toBeNull();
    expect(stats.pull_rate).toBeNull();
    expect(stats.findings_by_category).toEqual({});
    expect(stats.unattributed_count).toBe(0);
  });

  it('GET /skills returns the card-footer rollups', async () => {
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const seeded = list.find((s: { name: string }) => s.name === 'test-coverage-nudge');
    // Seeded and linked to Test Quality Reviewer, so used_by is real; the rates
    // have nothing to measure in a fresh workspace.
    expect(seeded.used_by_count).toBeGreaterThanOrEqual(1);
    expect(seeded.accept_rate).toBeNull();
  });

  it('deleting a skill NULLS its findings\' skill_id instead of deleting them', async () => {
    const skill = (await create({ name: 'it-fk', body: 'x' })).json();
    // `reviews.pr_id` is NOT NULL, so hang this off the seeded demo PR.
    const [pull] = await pg.handle.db.select().from(t.pullRequests).limit(1);
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: pull!.workspaceId,
        prId: pull!.id,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: 80,
      })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category: 'test',
        title: 't',
        rationale: 'r',
        confidence: 0.5,
        skillId: skill.id,
      })
      .returning();

    await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });

    const [after] = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.id, finding!.id));
    // A finding is a historical fact about a review — ON DELETE SET NULL, not
    // cascade, which is why this row must survive its skill.
    expect(after).toBeDefined();
    expect(after!.skillId).toBeNull();
  });

  it('POST /agents/:id/skills replaces the ordered set (attach, reorder, detach)', async () => {
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'API Contract Reviewer'));
    const library = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const pick = (name: string) => library.find((s: { name: string }) => s.name === name).id;

    const a = pick('api-contract-gate');
    const b = pick('phantom-api-gate');

    const reordered = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [b, a] },
    });
    expect(reordered.statusCode).toBe(200);
    // Order is the order of the blocks in the prompt, so it must round-trip.
    expect(
      reordered
        .json()
        .sort((x: { order: number }, y: { order: number }) => x.order - y.order)
        .map((l: { skill_id: string }) => l.skill_id),
    ).toEqual([b, a]);

    const detached = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [] },
    });
    expect(detached.json()).toHaveLength(0);
  });
});
