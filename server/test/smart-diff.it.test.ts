import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { CompletionRequest, CompletionResult, StructuredRequest, StructuredResult } from '@devdigest/shared';

/**
 * DB-backed coverage for the smart-diff slice. Named `*.it.test.ts` because it
 * needs real Postgres — any other name and the CI unit/integration split breaks
 * silently.
 *
 * Two negative assertions carry the feature's contract:
 *  - the response contains no `patch` text, only paths, counts and line numbers;
 *  - no model is called, proved by an `LLMProvider` that throws on every method.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping Testcontainers tests.');
}

const CORE_PATCH = [
  '@@ -1,3 +1,5 @@ export function config() {',
  ' const port = 3000;',
  "+const stripeKey = 'sk_live_SMARTDIFF_TEST';",
].join('\n');

const LOCK_PATCH = ['@@ -1,2 +1,3 @@', '+  smart-diff-lockfile-body-marker: 1.0.0'].join('\n');

/** Every method throws: if the endpoint ever calls a model, the request fails. */
class ExplodingLLM extends MockLLMProvider {
  override async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('smart-diff must not call a model');
  }
  override async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('smart-diff must not call a model');
  }
}

d('Testcontainers: smart diff', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;
  let unreviewedPrId: string;
  let foreignPrId: string;
  let llm: ExplodingLLM;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;

    const [pull] = await db.select().from(t.pullRequests);
    prId = pull!.id;

    await db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    await db.insert(t.prFiles).values([
      { prId, path: 'server/src/modules/billing/service.ts', additions: 40, deletions: 4, patch: CORE_PATCH },
      { prId, path: 'server/src/modules/billing/helpers.ts', additions: 12, deletions: 0, patch: CORE_PATCH },
      { prId, path: 'server/src/modules/billing/index.ts', additions: 2, deletions: 0, patch: CORE_PATCH },
      { prId, path: 'package.json', additions: 1, deletions: 1, patch: CORE_PATCH },
      { prId, path: 'pnpm-lock.yaml', additions: 30, deletions: 12, patch: LOCK_PATCH },
    ]);

    // One review with two findings on a core file — including two agents
    // flagging the SAME line, which must collapse to one entry.
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: pull!.workspaceId,
        prId,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seeded',
        score: 50,
        model: 'mock',
      })
      .returning();

    const finding = (startLine: number) => ({
      reviewId: review!.id,
      file: 'server/src/modules/billing/service.ts',
      startLine,
      endLine: startLine,
      severity: 'CRITICAL',
      category: 'security',
      title: 'seeded finding',
      rationale: 'seeded rationale',
      confidence: 1,
    });
    await db.insert(t.findings).values([finding(3), finding(17), finding(17)]);

    // A pull request in the SAME workspace that no review has ever touched —
    // the state every PR is in before the first Run Review.
    const [unreviewed] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: pull!.workspaceId,
        repoId: pull!.repoId,
        number: pull!.number + 20_000,
        title: 'not reviewed yet',
        author: 'someone',
        branch: 'feat/unreviewed',
        base: 'main',
        headSha: 'sha-unreviewed',
      })
      .returning();
    unreviewedPrId = unreviewed!.id;
    await db.insert(t.prFiles).values([
      { prId: unreviewedPrId, path: 'server/src/modules/billing/service.ts', additions: 9, deletions: 1, patch: CORE_PATCH },
      { prId: unreviewedPrId, path: 'server/src/modules/billing/index.ts', additions: 2, deletions: 0, patch: CORE_PATCH },
      { prId: unreviewedPrId, path: 'pnpm-lock.yaml', additions: 8, deletions: 2, patch: LOCK_PATCH },
    ]);

    // A pull request that belongs to a DIFFERENT workspace than the request
    // context resolves to. Same repo, so only the tenancy differs.
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreign] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: pull!.repoId,
        number: pull!.number + 10_000,
        title: 'foreign',
        author: 'someone',
        branch: 'feat/foreign',
        base: 'main',
        headSha: 'sha-foreign',
      })
      .returning();
    foreignPrId = foreign!.id;
    await db.insert(t.prFiles).values({
      prId: foreignPrId,
      path: 'server/src/secret.ts',
      additions: 1,
      deletions: 0,
      patch: CORE_PATCH,
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    llm = new ExplodingLLM();
    app = await buildApp({
      config,
      db,
      overrides: { llm: { openrouter: llm, openai: llm, anthropic: llm } },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const get = (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });

  it('returns all three groups in order, core first', async () => {
    const res = await get(prId);
    expect(res.statusCode).toBe(200);
    expect(res.json().groups.map((g: { role: string }) => g.role)).toEqual([
      'core',
      'wiring',
      'boilerplate',
    ]);
  });

  it('returns a payload the SmartDiff contract itself accepts', async () => {
    // The route's own serialization is what is under test here: the helper test
    // parses the builder's output, which never travels through Fastify.
    const parsed = SmartDiff.parse((await get(prId)).json());
    expect(parsed.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(parsed.split_suggestion.too_big).toBe(false);
  });

  it('before any review exists: full ordering, every finding_lines empty', async () => {
    const res = await get(unreviewedPrId);
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups.flatMap((g) => g.files.map((f) => f.path))).toEqual([
      'server/src/modules/billing/service.ts',
      'server/src/modules/billing/index.ts',
      'pnpm-lock.yaml',
    ]);
    expect(body.groups.flatMap((g) => g.files.flatMap((f) => f.finding_lines))).toEqual([]);
  });

  it('puts the lock file in boilerplate and nowhere else', async () => {
    const body = bodyOf(await get(prId));
    const groupOf = (path: string) =>
      body.groups.filter((g) => g.files.some((f) => f.path === path)).map((g) => g.role);

    expect(groupOf('pnpm-lock.yaml')).toEqual(['boilerplate']);
    expect(groupOf('package.json')).toEqual(['boilerplate']);
    expect(groupOf('server/src/modules/billing/index.ts')).toEqual(['wiring']);
    expect(groupOf('server/src/modules/billing/service.ts')).toEqual(['core']);
  });

  it('reports the seeded start_lines, deduplicated, on the flagged core file', async () => {
    const body = bodyOf(await get(prId));
    const core = body.groups.find((g) => g.role === 'core')!;
    // Most findings first, so the flagged file leads its group.
    expect(core.files[0]!.path).toBe('server/src/modules/billing/service.ts');
    expect(core.files[0]!.finding_lines).toEqual([3, 17]);
    expect(core.files[1]!.finding_lines).toEqual([]);
  });

  it('carries NO patch text anywhere in the response', async () => {
    const res = await get(prId);
    expect(res.body).not.toContain('sk_live_SMARTDIFF_TEST');
    expect(res.body).not.toContain('smart-diff-lockfile-body-marker');
    expect(res.body).not.toContain('@@');
    expect(res.body).not.toContain('patch');
  });

  it('makes NO model call — the provider throws on every method and the request still succeeds', async () => {
    llm.calls.length = 0;
    const res = await get(prId);
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toHaveLength(0);
  });

  it('a PR in another workspace returns 404, not its data', async () => {
    const res = await get(foreignPrId);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('server/src/secret.ts');
  });
});

/** Typed body of an inject response, so the assertions above stay readable. */
function bodyOf(res: { json: () => unknown }): {
  groups: { role: string; files: { path: string; finding_lines: number[] }[] }[];
} {
  return res.json() as {
    groups: { role: string; files: { path: string; finding_lines: number[] }[] }[];
  };
}
