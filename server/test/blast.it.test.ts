import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { BlastRadiusResponse } from '@devdigest/shared';
import type {
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/blast/constants.js';

/**
 * DB-backed coverage for the blast slice. Named `*.it.test.ts` because it needs
 * real Postgres — any other name and the CI unit/integration split breaks
 * silently. Run it ALONE with `--no-file-parallelism`.
 *
 * Three negative assertions carry the feature's contract:
 *  - no model is called, proved by an `LLMProvider` that throws on every method;
 *  - the AST/ripgrep walk is never entered, proved by a `codeIndex` whose
 *    `symbols()`/`references()` throw — that stub is exactly what
 *    `repo-intel/service.ts`'s fallback would call;
 *  - a partial or degraded index is REPORTED, never masked as an empty array.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping Testcontainers tests.');
}

/** Every method throws: if the endpoint ever calls a model, the request fails. */
class ExplodingLLM extends MockLLMProvider {
  override async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('blast must not call a model');
  }
  override async completeStructured<T>(
    _req: StructuredRequest<T>,
  ): Promise<StructuredResult<T>> {
    throw new Error('blast must not call a model');
  }
}

/**
 * The ripgrep/AST path detector. `repo-intel/service.ts` reaches
 * `codeIndex.symbols(ref)` and `.references(ref, name)` ONLY on the fallback that
 * walks the whole clone at request time; throwing here turns "the fallback ran"
 * into a failing test rather than a slow one.
 */
const explodingCodeIndex = {
  grep: async () => {
    throw new Error('blast must not grep the clone');
  },
  symbols: async () => {
    throw new Error('blast must not walk the clone for symbols');
  },
  references: async () => {
    throw new Error('blast must not walk the clone for references');
  },
};

const DECL_A = 'server/src/platform/limiter.ts';
const DECL_B = 'server/src/platform/clock.ts';
const CALLER_1 = 'server/src/app.ts';
const CALLER_2 = 'server/src/modules/pulls/routes.ts';
const PATCH = '@@ -1,2 +1,3 @@\n+const x = 1;';

d('Testcontainers: blast radius', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let workspaceId: string;
  let prId: string;
  let mdOnlyPrId: string;
  let unindexedPrId: string;
  let fanOutPrId: string;
  let foreignPrId: string;
  let llm: ExplodingLLM;

  /** Rewrite `repo_index_state.status` for the case under test. */
  const setStatus = async (status: 'full' | 'partial' | 'degraded' | 'failed') => {
    await pg.handle.db
      .insert(t.repoIndexState)
      .values({
        repoId,
        lastIndexedSha: 'indexed-sha',
        indexerVersion: 2,
        status,
        filesIndexed: 12,
        filesSkipped: 0,
      })
      .onConflictDoUpdate({
        target: t.repoIndexState.repoId,
        set: { status, lastIndexedSha: 'indexed-sha' },
      });
  };

  const dropIndexState = () =>
    pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;

    const [pull] = await db.select().from(t.pullRequests);
    prId = pull!.id;
    repoId = pull!.repoId;
    workspaceId = pull!.workspaceId;

    // --- the PR under test: two changed source files, both indexed -----------
    await db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    await db.insert(t.prFiles).values([
      { prId, path: DECL_A, additions: 10, deletions: 2, patch: PATCH },
      { prId, path: DECL_B, additions: 4, deletions: 0, patch: PATCH },
      { prId, path: 'README.md', additions: 1, deletions: 0, patch: PATCH },
    ]);

    // --- the index fixtures (the seed has no repo-intel rows) ----------------
    await db.insert(t.symbols).values([
      { repoId, path: DECL_A, name: 'rateLimit', kind: 'function', line: 12, endLine: 40, exported: true },
      // The qualified dual-emit the indexer writes beside a bare method name.
      { repoId, path: DECL_A, name: 'Limiter.rateLimit', kind: 'method', line: 12, endLine: 40, exported: true },
      { repoId, path: DECL_B, name: 'nowMs', kind: 'function', line: 3, endLine: 5, exported: true },
      // A symbol declared in a CALLER file, so the enclosing-symbol lookup works.
      { repoId, path: CALLER_1, name: 'buildApp', kind: 'function', line: 1, endLine: 400, exported: true },
      { repoId, path: CALLER_2, name: 'pullsRoutes', kind: 'function', line: 1, endLine: 200, exported: true },
    ]);

    await db.insert(t.references).values([
      // Cross-file callers of `rateLimit`, resolved to its declaring file.
      { repoId, fromPath: CALLER_1, toSymbol: 'rateLimit', line: 96, declFile: DECL_A },
      { repoId, fromPath: CALLER_2, toSymbol: 'rateLimit', line: 49, declFile: DECL_A },
      // A reference INSIDE the declaration's own file — must be excluded.
      { repoId, fromPath: DECL_A, toSymbol: 'rateLimit', line: 55, declFile: DECL_A },
      // One caller of `nowMs`.
      { repoId, fromPath: CALLER_2, toSymbol: 'nowMs', line: 7, declFile: DECL_B },
    ]);

    await db.insert(t.fileRank).values([
      { repoId, filePath: CALLER_1, pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 99 },
      { repoId, filePath: CALLER_2, pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 80 },
      { repoId, filePath: DECL_A, pagerank: 0.4, hotness: 0, rank: 0.4, percentile: 70 },
    ]);

    await db.insert(t.fileFacts).values([
      { repoId, filePath: CALLER_1, endpoints: ['GET /pulls/:id'], crons: ['job:poll_repos'] },
      { repoId, filePath: CALLER_2, endpoints: ['POST /pulls/:id/review'], crons: [] },
    ]);

    await setStatus('full');

    // --- a PR whose changed files are all Markdown --------------------------
    const makePr = async (number: number, title: string, ws = workspaceId) => {
      const [row] = await db
        .insert(t.pullRequests)
        .values({
          workspaceId: ws,
          repoId,
          number,
          title,
          author: 'someone',
          branch: `feat/${number}`,
          base: 'main',
          headSha: `sha-${number}`,
        })
        .returning();
      return row!.id;
    };

    mdOnlyPrId = await makePr(pull!.number + 30_000, 'docs only');
    await db.insert(t.prFiles).values([
      { prId: mdOnlyPrId, path: 'README.md', additions: 3, deletions: 1, patch: PATCH },
      { prId: mdOnlyPrId, path: 'docs/x.md', additions: 2, deletions: 0, patch: PATCH },
    ]);

    // --- a PR whose source files carry NO symbols in the index ---------------
    unindexedPrId = await makePr(pull!.number + 31_000, 'brand new file');
    await db.insert(t.prFiles).values({
      prId: unindexedPrId,
      path: 'server/src/modules/brand-new/service.ts',
      additions: 40,
      deletions: 0,
      patch: PATCH,
    });

    // --- a PR with 25 references per symbol, to exercise the clamp -----------
    fanOutPrId = await makePr(pull!.number + 32_000, 'wide fan-out');
    await db.insert(t.prFiles).values({
      prId: fanOutPrId,
      path: 'server/src/wide/hub.ts',
      additions: 5,
      deletions: 0,
      patch: PATCH,
    });
    await db.insert(t.symbols).values([
      { repoId, path: 'server/src/wide/hub.ts', name: 'hubA', kind: 'function', line: 1, endLine: 2, exported: true },
      { repoId, path: 'server/src/wide/hub.ts', name: 'hubB', kind: 'function', line: 4, endLine: 5, exported: true },
    ]);
    for (const sym of ['hubA', 'hubB']) {
      const callerFiles = Array.from(
        { length: MAX_CALLERS_PER_SYMBOL + 5 },
        (_, i) => `server/src/wide/${sym}-caller-${String(i).padStart(2, '0')}.ts`,
      );
      await db.insert(t.references).values(
        callerFiles.map((file, i) => ({
          repoId,
          fromPath: file,
          toSymbol: sym,
          line: i + 1,
          declFile: 'server/src/wide/hub.ts',
        })),
      );
      await db.insert(t.fileRank).values(
        callerFiles.map((file, i) => ({
          repoId,
          filePath: file,
          pagerank: 1 - i / 100,
          hotness: 0,
          rank: 1 - i / 100,
          percentile: 50,
        })),
      );
    }
    // A reference from the declaring file itself — the exclusion must hold here too.
    await db.insert(t.references).values({
      repoId,
      fromPath: 'server/src/wide/hub.ts',
      toSymbol: 'hubA',
      line: 9,
      declFile: 'server/src/wide/hub.ts',
    });

    // --- a PR in a DIFFERENT workspace --------------------------------------
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    foreignPrId = await makePr(pull!.number + 33_000, 'foreign', otherWs!.id);
    await db.insert(t.prFiles).values({
      prId: foreignPrId,
      path: 'server/src/secret-foreign.ts',
      additions: 1,
      deletions: 0,
      patch: PATCH,
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    llm = new ExplodingLLM();
    app = await buildApp({
      config,
      db,
      overrides: {
        llm: { openrouter: llm, openai: llm, anthropic: llm },
        codeIndex: explodingCodeIndex as never,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const get = (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/blast` });

  /** Parse through the contract, so every case also proves criterion 1. */
  const body = async (id: string) => {
    const res = await get(id);
    expect(res.statusCode).toBe(200);
    return BlastRadiusResponse.parse(res.json());
  };

  it("case 1 — status='full': state 'full', no reason, callers and endpoints populated", async () => {
    await setStatus('full');
    llm.calls.length = 0;
    const parsed = await body(prId);

    expect(parsed.state).toBe('full');
    expect(parsed.reason == null).toBe(true);
    // The `Class.method` dual-emit is dropped; two real symbols remain.
    expect(parsed.changed_symbols.map((s) => s.name)).toEqual(['nowMs', 'rateLimit']);

    const rateLimit = parsed.downstream.find((d) => d.symbol === 'rateLimit')!;
    // Rank-descending: app.ts (0.9) before pulls/routes.ts (0.5).
    expect(rateLimit.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      `${CALLER_1}:96`,
      `${CALLER_2}:49`,
    ]);
    expect(rateLimit.callers.map((c) => c.name)).toEqual(['buildApp', 'pullsRoutes']);
    expect(rateLimit.endpoints_affected).toEqual(['GET /pulls/:id', 'POST /pulls/:id/review']);
    expect(rateLimit.crons_affected).toEqual(['job:poll_repos']);

    const nowMs = parsed.downstream.find((d) => d.symbol === 'nowMs')!;
    expect(nowMs.callers.map((c) => c.file)).toEqual([CALLER_2]);
    expect(nowMs.endpoints_affected).toEqual(['POST /pulls/:id/review']);

    // NO model call — the provider throws on every method and the request still
    // succeeded, so no LLM port was resolved.
    expect(llm.calls).toHaveLength(0);
  });

  it("case 1b — the declaring file's own reference is NOT a caller", async () => {
    await setStatus('full');
    const parsed = await body(prId);
    const rateLimit = parsed.downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.callers.some((c) => c.file === DECL_A)).toBe(false);
  });

  it("case 2 — status='partial' WITH file_rank rows: state 'partial', reason 'index_partial'", async () => {
    await setStatus('partial');
    const parsed = await body(prId);
    expect(parsed.state).toBe('partial');
    expect(parsed.reason).toBe('index_partial');
    expect(parsed.downstream.some((d) => d.callers.length > 0)).toBe(true);
    await setStatus('full');
  });

  it("case 3 — status='partial' with file_rank DELETED: degraded / no_rank_graph, not a silent empty array", async () => {
    await setStatus('partial');
    const { db } = pg.handle;
    const saved = await db.select().from(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    await db.delete(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    try {
      const parsed = await body(prId);
      expect(parsed.state).toBe('degraded');
      expect(parsed.reason).toBe('no_rank_graph');
      expect(parsed.downstream).toEqual([]);
      expect(parsed.summary.length).toBeGreaterThan(0);
      expect(parsed.summary).toContain('unavailable');
    } finally {
      await db.insert(t.fileRank).values(saved);
      await setStatus('full');
    }
  });

  it("case 4 — no repo_index_state row at all: degraded / no_index", async () => {
    await dropIndexState();
    try {
      const parsed = await body(prId);
      expect(parsed.state).toBe('degraded');
      expect(parsed.reason).toBe('no_index');
      expect(parsed.downstream).toEqual([]);
    } finally {
      await setStatus('full');
    }
  });

  it("case 5 — an all-Markdown PR: state 'full', empty is DISTINCT from degraded", async () => {
    await setStatus('full');
    const parsed = await body(mdOnlyPrId);
    expect(parsed.state).toBe('full');
    expect(parsed.reason == null).toBe(true);
    expect(parsed.changed_symbols).toEqual([]);
    expect(parsed.downstream).toEqual([]);
    expect(parsed.summary).toBe('No code symbols changed in this PR.');
  });

  it("case 6 — source files with no indexed symbols: partial / files_not_indexed", async () => {
    await setStatus('full');
    const parsed = await body(unindexedPrId);
    expect(parsed.state).toBe('partial');
    expect(parsed.reason).toBe('files_not_indexed');
    expect(parsed.changed_symbols).toEqual([]);
    expect(parsed.downstream).toEqual([]);
  });

  it('case 7 — 25 references per symbol clamp to 20 PER symbol, declaring file excluded', async () => {
    await setStatus('full');
    const parsed = await body(fanOutPrId);
    expect(parsed.state).toBe('full');
    expect(parsed.downstream).toHaveLength(2);
    for (const entry of parsed.downstream) {
      expect(entry.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
      const declFile = parsed.changed_symbols.find((s) => s.name === entry.symbol)!.file;
      expect(entry.callers.some((c) => c.file === declFile)).toBe(false);
    }
  });

  it('case 8 — a PR in another workspace returns 404, not its data', async () => {
    const res = await get(foreignPrId);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('server/src/secret-foreign.ts');
  });

  it('case 9 — a non-uuid :id is rejected with 422 before the handler runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);
  });

  it('case 10 — no reviews or agent_runs row is created by the request', async () => {
    const { db } = pg.handle;
    const before = await db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, prId)));
    const reviewsBefore = await db.select().from(t.reviews).where(eq(t.reviews.prId, prId));
    await setStatus('full');
    await body(prId);
    expect(
      await db.select().from(t.agentRuns).where(and(eq(t.agentRuns.prId, prId))),
    ).toHaveLength(before.length);
    expect(await db.select().from(t.reviews).where(eq(t.reviews.prId, prId))).toHaveLength(
      reviewsBefore.length,
    );
  });

  it("case 11 — `summary` is deterministic: two identical requests, byte-identical text", async () => {
    await setStatus('full');
    const a = await body(prId);
    const b = await body(prId);
    expect(a.summary).toBe(b.summary);
    expect(a.summary.length).toBeGreaterThan(0);
  });
});
