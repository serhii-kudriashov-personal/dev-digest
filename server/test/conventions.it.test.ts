import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockCodeIndex, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { CodeIndex, CodeMatch } from '@devdigest/shared';

/**
 * DB-backed coverage for the conventions extractor. Named `*.it.test.ts` because it
 * needs real Postgres — any other name and the CI unit/integration split breaks
 * silently.
 *
 * The LLM fixture is keyed by ONE schema name. That is the point of the design:
 * sampling is pure code, so the whole scan is a single structured call and the mock
 * has no conversation to replay.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping Testcontainers tests.');
}

const USERS_TS = [
  'import { db } from "./db";',
  '',
  'export async function loadUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  const posts = await db.posts.findMany({ userId: id });',
  '  return { user, posts };',
  '}',
].join('\n');

const REDIS_TS = 'export const redis = new Redis(config.redisUrl);\n';

const FILES: Record<string, string> = {
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
  'package.json': '{ "name": "payments-api" }\n',
  'src/api/users.ts': USERS_TS,
  'src/lib/redis.ts': REDIS_TS,
};

/**
 * `getConventionSamples` is the intended primary source of the sample, so it is
 * stubbed rather than left to degrade. Only `getConventionSamples` is reachable
 * from this module, hence the narrow cast.
 */
const repoIntelStub = (samples: string[]) =>
  ({ getConventionSamples: async () => samples }) as unknown as RepoIntel;

const codeIndexStub = (paths: string[]) =>
  ({
    grep: async (): Promise<CodeMatch[]> =>
      paths.map((path, i) => ({ path, line: i + 1, text: 'match' })),
    symbols: async () => [],
    references: async () => [],
  }) as unknown as CodeIndex;

/** Two provable candidates and two the gate must throw away. */
const EXTRACTION = {
  conventions: [
    {
      category: 'structure',
      rule: 'Always use async/await instead of .then() chains.',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'const user = await db.users.find(id);',
      confidence: 0.91,
    },
    {
      category: 'structure',
      rule: 'Redis access goes through the src/lib/redis.ts singleton.',
      evidence_path: 'src/lib/redis.ts',
      evidence_snippet: 'export const redis = new Redis(config.redisUrl);',
      confidence: 0.85,
    },
    {
      // hallucinated path — nothing sampled this file
      category: 'naming',
      rule: 'Controllers are suffixed with Controller.',
      evidence_path: 'src/http/user.controller.ts',
      evidence_snippet: 'export class UserController {}',
      confidence: 1,
    },
    {
      // real file, invented snippet
      category: 'error-handling',
      rule: 'Every query is wrapped in tryCatch.',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'tryCatch(() => db.users.find(id))',
      confidence: 1,
    },
  ],
};

d('Testcontainers: conventions extractor', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [repo] = await pg.handle.db.select().from(t.repos);
    repoId = repo!.id;
    workspaceId = repo!.workspaceId;
    // The seed ships `clone_path: null` so the 409 path is reachable; the happy
    // path needs a clone to exist.
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(eq(t.repos.id, repoId));

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        codeIndex: new MockCodeIndex(),
        repoIntel: repoIntelStub(['src/api/users.ts', 'src/lib/redis.ts']),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: EXTRACTION },
          }),
        },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.conventions).where(eq(t.conventions.workspaceId, workspaceId));
    await pg.handle.db
      .delete(t.conventionScans)
      .where(eq(t.conventionScans.workspaceId, workspaceId));
  });

  const extract = () =>
    app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

  const list = () => app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });

  const setStatus = (ids: string[], status: string) =>
    app.inject({
      method: 'PATCH',
      url: `/repos/${repoId}/conventions/status`,
      payload: { ids, status },
    });

  it('DROPS the candidates whose evidence cannot be proven', async () => {
    const res = await extract();
    expect(res.statusCode).toBe(200);
    const { candidates, last_scan } = res.json();

    // 4 claimed, 2 provable.
    expect(candidates).toHaveLength(2);
    const rules = candidates.map((c: { rule: string }) => c.rule);
    expect(rules).toContain('Always use async/await instead of .then() chains.');
    expect(rules).toContain('Redis access goes through the src/lib/redis.ts singleton.');
    // A hallucinated path and an invented snippet are both gone, despite arriving
    // at confidence 1.0 — which is exactly why confidence is never gated on.
    expect(rules).not.toContain('Controllers are suffixed with Controller.');
    expect(rules).not.toContain('Every query is wrapped in tryCatch.');

    expect(last_scan.dropped).toBe(2);
    expect(last_scan.candidates).toBe(2);
  });

  it('computes the evidence line range itself rather than trusting the model', async () => {
    const { candidates } = (await extract()).json();
    const asyncRule = candidates.find((c: { category: string }) => c.category === 'structure');
    const users = candidates.find(
      (c: { evidence_path: string }) => c.evidence_path === 'src/api/users.ts',
    );
    expect(asyncRule).toBeDefined();
    // `const user = await db.users.find(id);` is line 4 of the fixture.
    expect(users.evidence_line_start).toBe(4);
    expect(users.evidence_line_end).toBe(4);
  });

  it('records ONE scan row carrying the sample count and the model', async () => {
    await extract();
    const scans = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId));
    expect(scans).toHaveLength(1);
    // configs + the ranked/grep sample, minus anything that read empty.
    expect(scans[0]!.filesSampled).toBeGreaterThan(0);
    expect(scans[0]!.provider).toBe('openai');
    expect(scans[0]!.model).toBeTruthy();
  });

  it('makes exactly ONE model call per scan — sampling asks the model nothing', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    });
    const solo = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        codeIndex: new MockCodeIndex(),
        repoIntel: repoIntelStub(['src/api/users.ts', 'src/lib/redis.ts']),
        llm: { openai: llm },
      },
    });
    try {
      await solo.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      });
      const structured = llm.calls.filter((c) => c.method === 'completeStructured');
      expect(structured).toHaveLength(1);
      expect((structured[0]!.req as { schemaName: string }).schemaName).toBe(
        'ConventionExtraction',
      );
    } finally {
      await solo.close();
    }
  });

  it('sends repo content as UNTRUSTED data, never as instructions', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    });
    const solo = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        codeIndex: new MockCodeIndex(),
        repoIntel: repoIntelStub(['src/api/users.ts', 'src/lib/redis.ts']),
        llm: { openai: llm },
      },
    });
    try {
      await solo.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      });
      const req = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
        messages: { role: string; content: string }[];
      };
      const user = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      expect(user).toContain('<untrusted');
      expect(user).toContain('const user = await db.users.find(id);');
    } finally {
      await solo.close();
    }
  });

  it('a re-scan preserves accepted AND rejected verdicts and replaces only pending', async () => {
    const first = (await extract()).json().candidates;
    const [keep, drop] = first;
    await setStatus([keep.id], 'accepted');
    await setStatus([drop.id], 'rejected');

    const second = (await extract()).json().candidates;
    const byId = new Map(second.map((c: { id: string }) => [c.id, c]));
    expect(byId.get(keep.id)).toMatchObject({ status: 'accepted' });
    expect(byId.get(drop.id)).toMatchObject({ status: 'rejected' });
    // Both rules were already judged, so neither is re-proposed as a duplicate.
    expect(second).toHaveLength(2);
  });

  it('does not re-insert a rule that was already judged', async () => {
    const first = (await extract()).json().candidates;
    await setStatus(
      first.map((c: { id: string }) => c.id),
      'rejected',
    );
    const second = (await extract()).json().candidates;
    expect(second).toHaveLength(2);
    expect(second.every((c: { status: string }) => c.status === 'rejected')).toBe(true);
  });

  it('PATCH /conventions/:id edits the rule and leaves the evidence untouched', async () => {
    const [c] = (await extract()).json().candidates;
    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${c.id}`,
      payload: { rule: 'Prefer async/await over promise chains.' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.rule).toBe('Prefer async/await over promise chains.');
    expect(updated.evidence_path).toBe(c.evidence_path);
    expect(updated.evidence_snippet).toBe(c.evidence_snippet);
    expect(updated.evidence_line_start).toBe(c.evidence_line_start);
    expect(updated.confidence).toBe(c.confidence);
  });

  it('the bulk status route serves accept, reject AND "deselect all"', async () => {
    const cands = (await extract()).json().candidates;
    const ids = cands.map((c: { id: string }) => c.id);

    await setStatus(ids, 'accepted');
    expect(
      (await list()).json().candidates.every((c: { status: string }) => c.status === 'accepted'),
    ).toBe(true);

    // Deselect all returns to pending, NOT to rejected — deselecting is not a verdict.
    const res = await setStatus(ids, 'pending');
    expect(res.statusCode).toBe(200);
    expect(
      (await list()).json().candidates.every((c: { status: string }) => c.status === 'pending'),
    ).toBe(true);
  });

  it('skill-draft merges the accepted rules and persists NOTHING', async () => {
    const cands = (await extract()).json().candidates;
    const ids = cands.map((c: { id: string }) => c.id);
    await setStatus(ids, 'accepted');

    const before = await pg.handle.db.select().from(t.skills);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-draft`,
      payload: { convention_ids: ids },
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json();

    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.enabled).toBe(true);
    expect(draft.body).toContain('Report a **WARNING**');
    expect(draft.body).toContain('src/api/users.ts:4');
    expect(draft.evidence_files).toContain('src/api/users.ts');

    const after = await pg.handle.db.select().from(t.skills);
    expect(after).toHaveLength(before.length);
  });

  it('the draft saves through POST /skills, recording source and evidence_files', async () => {
    const cands = (await extract()).json().candidates;
    const ids = cands.map((c: { id: string }) => c.id);
    await setStatus(ids, 'accepted');
    const draft = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill-draft`,
        payload: { convention_ids: ids },
      })
    ).json();

    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        source: 'extracted',
        body: draft.body,
        enabled: draft.enabled,
        evidence_files: draft.evidence_files,
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.source).toBe('extracted');
    expect(skill.type).toBe('convention');
    expect(skill.enabled).toBe(true);
    expect(skill.evidence_files).toContain('src/api/users.ts');

    // And it can be attached to an agent — without a link it reaches no review.
    const [agent] = await pg.handle.db.select().from(t.agents);
    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: skill.id },
    });
    expect(linked.statusCode).toBe(200);
    const rows = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agent!.id), eq(t.agentSkills.skillId, skill.id)));
    expect(rows).toHaveLength(1);

    await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
  });

  it('answers 409 when the repo has no clone', async () => {
    await pg.handle.db.update(t.repos).set({ clonePath: null }).where(eq(t.repos.id, repoId));
    try {
      const res = await extract();
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('repo_not_cloned');
    } finally {
      await pg.handle.db
        .update(t.repos)
        .set({ clonePath: '/mock/clones/acme/payments-api' })
        .where(eq(t.repos.id, repoId));
    }
  });

  it('GET returns last_scan = null before any scan has run', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json().last_scan).toBeNull();
    expect(res.json().candidates).toEqual([]);
  });

  it('falls back to grep when repo-intel yields nothing — an unindexed repo still scans', async () => {
    // `getConventionSamples` returns [] for an unindexed repo, and for a workspace
    // with repo-intel switched off. Neither is an error, so neither may block a scan.
    const solo = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        codeIndex: codeIndexStub(['src/api/users.ts', 'src/lib/redis.ts']),
        repoIntel: repoIntelStub([]),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: EXTRACTION },
          }),
        },
      },
    });
    try {
      const res = await solo.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().candidates).toHaveLength(2);
    } finally {
      await solo.close();
    }
  });
});
