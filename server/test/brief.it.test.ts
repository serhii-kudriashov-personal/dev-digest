import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { BriefAnswer, StructuredRequest, StructuredResult } from '@devdigest/shared';

/**
 * DB-backed coverage for the PR Risk Brief slice. Named `*.it.test.ts` because it
 * needs real Postgres — any other name and the CI unit/integration split breaks
 * silently. Run it ALONE with `--no-file-parallelism`.
 *
 * Three enforcement points are asserted end to end here rather than only at the
 * helper level: no raw patch body (AC-8), no finding rationale/suggestion (AC-9),
 * no confidence number (AC-10) ever reach `pr_brief.json`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping Testcontainers tests.');
}

const PATCH_SECRET_LINE = "+const DO_NOT_LEAK_PATCH_BODY = 'xyz-patch-body-marker';";
const PATCH = [
  '@@ -1,3 +1,5 @@ export function limiter() {',
  ' const a = 1;',
  '-const old = 1;',
  PATCH_SECRET_LINE,
  '+const limiter = true;',
  ' return a;',
].join('\n');

const RATIONALE_MARKER = 'RATIONALE_MARKER_9f3_do_not_leak';
const SUGGESTION_MARKER = 'SUGGESTION_MARKER_7ab_do_not_leak';
const FINDING_CONFIDENCE = 0.42;

/** A valid, non-restating answer that also passes validateFocus/validateRisks —
 *  every ref it names is real. */
const ANSWER: BriefAnswer = {
  what: 'This pull request adds a token-bucket rate limiter to the public API.',
  why: 'Public endpoints were being scraped without any request throttling.',
  risk_level: 'medium',
  risks: [
    {
      title: 'Rate limiter bypass on retries',
      explanation: 'A client retry storm could still exhaust the limiter state.',
      severity: 'medium',
      file_refs: ['src/limiter.ts'],
      endpoint_refs: [],
    },
  ],
  review_focus: [{ path: 'src/limiter.ts', line: 2, reason: 'Core limiter logic changed here.' }],
};

/** Restates the PR title exactly (case/whitespace/punctuation-insensitive) —
 *  the `unusable_answer` failure path. */
const TITLE_RESTATING_ANSWER: BriefAnswer = {
  ...ANSWER,
  what: 'Add rate limiting to public API endpoints',
};

/** Throws on every structured call — the `provider_error` failure path. */
class RejectingLLM extends MockLLMProvider {
  override async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('provider 503 from the brief endpoint');
  }
}

/** A tokenizer whose `count()` always throws — AC-12's fallback path. */
const throwingTokenizer = {
  count: () => {
    throw new Error('tokenizer unavailable');
  },
};

d('Testcontainers: PR risk brief', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;
  let workspaceId: string;
  let repoId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;

    const [pull] = await db.select().from(t.pullRequests);
    prId = pull!.id;
    workspaceId = pull!.workspaceId;
    repoId = pull!.repoId;

    // A body with no closing keyword and no linked spec path — collectBlocks'
    // linked_issue/linked_spec sources degrade to "missing" without any
    // GitHub/git call, so no override for either is needed.
    await db
      .update(t.pullRequests)
      .set({ body: 'Adds a rate limiter.', headSha: 'sha-original' })
      .where(eq(t.pullRequests.id, prId));

    await db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    await db.insert(t.prFiles).values([
      { prId, path: 'src/limiter.ts', additions: 3, deletions: 1, patch: PATCH },
      { prId, path: 'src/other.ts', additions: 1, deletions: 0, patch: PATCH },
    ]);

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    llm = new MockLLMProvider('openai', { structuredBySchema: { BriefAnswer: ANSWER } });
    app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: llm } },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    const { db } = pg.handle;
    await db.delete(t.prBrief).where(eq(t.prBrief.prId, prId));
    // Cascades to `findings` (`findings.review_id` is `onDelete: 'cascade'`).
    await db.delete(t.reviews).where(eq(t.reviews.prId, prId));
    await db
      .update(t.pullRequests)
      .set({ headSha: 'sha-original' })
      .where(eq(t.pullRequests.id, prId));
    llm.calls.length = 0;

    // One completed review with one finding, so AC-9's rationale/suggestion and
    // AC-10's confidence have something real to prove NEVER leaks. Inserted
    // BEFORE each case runs so its `createdAt` always precedes the brief's
    // `generated_at` — otherwise the staleness check would treat every fresh
    // brief as stale-by-a-later-review and break the AC-2 caching case.
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'review',
        verdict: 'comment',
        summary: 'looks fine',
        score: 80,
        model: 'test-model',
      })
      .returning();
    await db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'src/limiter.ts',
      startLine: 2,
      endLine: 2,
      severity: 'WARNING',
      category: 'perf',
      title: 'Possible limiter bypass',
      rationale: RATIONALE_MARKER,
      suggestion: SUGGESTION_MARKER,
      confidence: FINDING_CONFIDENCE,
    });
  });

  const post = (payload: Record<string, unknown> = {}, target = prId) =>
    app.inject({ method: 'POST', url: `/pulls/${target}/brief`, payload });

  const get = (target = prId) => app.inject({ method: 'GET', url: `/pulls/${target}/brief` });

  const modelCalls = () => llm.calls.filter((c) => c.method === 'completeStructured').length;

  it('AC-1: first POST generates and persists a brief; the model is called exactly once', async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('ok');
    expect(body.brief.what).toBe(ANSWER.what);
    expect(body.brief.risk_level).toBe('medium');
    expect(body.brief.head_sha).toBe('sha-original');
    expect(body.brief.provider).toBe('openai');
    expect(modelCalls()).toBe(1);

    const stored = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(stored).toHaveLength(1);
  });

  it('AC-2: a second POST with no force, same head, makes NO model call and returns the cached document', async () => {
    const first = await post();
    expect(modelCalls()).toBe(1);

    const second = await post();
    expect(second.statusCode).toBe(200);
    expect(modelCalls()).toBe(1); // unchanged
    expect(second.json().brief.generated_at).toBe(first.json().brief.generated_at);
  });

  it('AC-3: {force:true} re-generates and REPLACES the stored document', async () => {
    const first = await post();
    const second = await post({ force: true });

    expect(modelCalls()).toBe(2);
    expect(second.statusCode).toBe(200);
    // A fresh document, not the same row content re-served.
    expect(second.json().brief.generated_at).not.toBe(first.json().brief.generated_at);

    const stored = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(stored).toHaveLength(1); // NFR-8: one brief per PR, no version history
  });

  it('AC-4/NFR-7: two concurrent POSTs for the same PR make exactly ONE model call (single-flight)', async () => {
    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(modelCalls()).toBe(1);
    // Both callers observe the SAME generated document.
    expect(r1.json().brief.generated_at).toBe(r2.json().brief.generated_at);
  });

  it('AC-5: GET after POST returns the same document, even from a freshly-built app (real persistence)', async () => {
    const posted = await post();

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app2 = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: new MockLLMProvider('openai') } },
    });
    try {
      const res = await app2.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
      expect(res.statusCode).toBe(200);
      expect(res.json().what).toBe(posted.json().brief.what);
      expect(res.json().generated_at).toBe(posted.json().brief.generated_at);
      expect(res.json().stale).toBe(false);
    } finally {
      await app2.close();
    }
  });

  it('AC-6: a foreign-workspace PR and a fabricated id are BOTH a plain 404 — never a 500, never leaking existence', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-brief-ws' }).returning();
    const [foreignPull] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId,
        number: 999_001,
        title: 'foreign secret title',
        author: 'someone',
        branch: 'feat/foreign',
        base: 'main',
        headSha: 'sha-foreign',
      })
      .returning();
    const foreignPrId = foreignPull!.id;
    const fabricatedId = '00000000-0000-4000-8000-000000000000';

    const foreignGet = await get(foreignPrId);
    const foreignPost = await post({}, foreignPrId);
    const fabricatedGet = await get(fabricatedId);
    const fabricatedPost = await post({}, fabricatedId);

    for (const res of [foreignGet, foreignPost, fabricatedGet, fabricatedPost]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
      expect(res.body).not.toContain('foreign secret title');
    }
    // Indistinguishable: identical error shape regardless of WHY it 404s.
    expect(foreignGet.json()).toEqual(fabricatedGet.json());
  });

  it('AC-8/9/10: the raw patch body, a finding rationale/suggestion, and confidence never reach the persisted document', async () => {
    await post();
    const stored = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    const json = JSON.stringify(stored[0]!.json);

    expect(json).not.toContain(PATCH_SECRET_LINE);
    expect(json).not.toContain('const old = 1');
    expect(json).not.toContain(RATIONALE_MARKER);
    expect(json).not.toContain(SUGGESTION_MARKER);
    expect(json).not.toContain(String(FINDING_CONFIDENCE));

    // …and the same holds for what was actually SENT to the model.
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const req = call!.req as { messages: { content: string }[] };
    const prompt = req.messages.map((m) => m.content).join('\n');
    expect(prompt).not.toContain(PATCH_SECRET_LINE);
    expect(prompt).not.toContain(RATIONALE_MARKER);
    expect(prompt).not.toContain(SUGGESTION_MARKER);
  });

  it('AC-12: a throwing tokenizer degrades to the char/4 heuristic — tokens_estimated: true', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const estimatingLlm = new MockLLMProvider('openai', {
      structuredBySchema: { BriefAnswer: ANSWER },
    });
    const app2 = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: estimatingLlm }, tokenizer: throwingTokenizer },
    });
    try {
      const res = await app2.inject({ method: 'POST', url: `/pulls/${prId}/brief`, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().brief.tokens_estimated).toBe(true);
    } finally {
      await app2.close();
    }
  });

  describe('the three non-200-error, still-200-response failure states', () => {
    it('AC-22: a title-restating answer is unusable_answer, and persists NOTHING', async () => {
      // Establish a good document first, so we can prove it stays untouched.
      const good = await post();
      expect(good.json().state).toBe('ok');

      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      const liar = new MockLLMProvider('openai', {
        structuredBySchema: { BriefAnswer: TITLE_RESTATING_ANSWER },
      });
      const app2 = await buildApp({
        config,
        db: pg.handle.db,
        overrides: { llm: { openai: liar } },
      });
      try {
        const res = await app2.inject({
          method: 'POST',
          url: `/pulls/${prId}/brief`,
          payload: { force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ state: 'failed', reason: 'unusable_answer' });

        const stillGet = await get();
        expect(stillGet.json().generated_at).toBe(good.json().brief.generated_at);
      } finally {
        await app2.close();
      }
    });

    it('AC-38: a throwing provider is provider_error, and the previous document is left untouched', async () => {
      const good = await post();

      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      const rejecting = new RejectingLLM('openai');
      const app2 = await buildApp({
        config,
        db: pg.handle.db,
        overrides: { llm: { openai: rejecting } },
      });
      try {
        const res = await app2.inject({
          method: 'POST',
          url: `/pulls/${prId}/brief`,
          payload: { force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ state: 'failed', reason: 'provider_error' });

        const stillGet = await get();
        expect(stillGet.json().generated_at).toBe(good.json().brief.generated_at);
      } finally {
        await app2.close();
      }
    });

    it('AC-39: no API key configured is not_configured — a normal 200, never a 500', async () => {
      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      // No `llm` override at all: resolution itself must fail via ConfigError,
      // and MockSecretsProvider({}) keeps this off the machine's real
      // ~/.devdigest/secrets.json and off the network.
      const app2 = await buildApp({
        config,
        db: pg.handle.db,
        overrides: { secrets: new MockSecretsProvider({}) },
      });
      try {
        const res = await app2.inject({
          method: 'POST',
          url: `/pulls/${prId}/brief`,
          payload: { force: true },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ state: 'not_configured' });
      } finally {
        await app2.close();
      }
    });
  });
});
