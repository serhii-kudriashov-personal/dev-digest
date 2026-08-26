import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { IssueMeta, StructuredRequest, StructuredResult } from '@devdigest/shared';

/**
 * DB-backed coverage for the intent slice. Named `*.it.test.ts` because it needs
 * real Postgres — any other name and the CI unit/integration split breaks
 * silently.
 *
 * The load-bearing assertion here is the negative one: the prompt handed to the
 * model carries the `@@` hunk HEADERS of a seeded patch and none of that
 * patch's body.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent] Docker not available — skipping Testcontainers tests.');
}

const SECRET_LINE = "+const stripeKey = 'sk_live_INTENT_TEST';";
const PATCH = [
  '@@ -1,3 +1,5 @@ export function config() {',
  ' const port = 3000;',
  "-const stripeKey = '';",
  SECRET_LINE,
  '+const limiter = true;',
  ' return port;',
].join('\n');

const SPEC_BODY = '# Rate limit plan\nAdd a limiter to every public endpoint.';

const CLASSIFICATION = {
  intent: 'Add rate limiting to the public API endpoints.',
  in_scope: ['a limiter on /api routes', 'config for the limiter'],
  out_of_scope: ['the admin endpoints, deferred to a follow-up'],
  confidence: 0.95,
  evidence_used: ['pr_title_body', 'linked_issue', 'linked_spec', 'hunk_headers'],
};

/** A provider whose classification call fails the way a real 5xx does. */
class RejectingLLM extends MockLLMProvider {
  override async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('provider 503 from the classifier endpoint');
  }
}

/** GitHub reachable, but the issue lookup fails. */
class FailingIssuesGitHub extends MockGitHubClient {
  override async getIssue(): Promise<IssueMeta> {
    throw new Error('github 502');
  }
}

d('Testcontainers: PR intent', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;
  let workspaceId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [pull] = await pg.handle.db.select().from(t.pullRequests);
    prId = pull!.id;
    workspaceId = pull!.workspaceId;

    // A body that links an issue by a closing keyword AND a plan file.
    await pg.handle.db
      .update(t.pullRequests)
      .set({
        body:
          'This PR adds a rate limiter to the public API so we stop getting scraped.\n' +
          'Fixes #42. Plan: [the plan](docs/plans/rate-limit.md)\n' +
          'Admin endpoints are deliberately out of scope for now.',
        headSha: 'sha-original',
      })
      .where(eq(t.pullRequests.id, prId));

    await pg.handle.db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    await pg.handle.db.insert(t.prFiles).values({
      prId,
      path: 'src/config.ts',
      additions: 2,
      deletions: 1,
      patch: PATCH,
    });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    llm = new MockLLMProvider('openai', {
      structuredBySchema: { IntentClassification: CLASSIFICATION },
    });
    app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: { 'docs/plans/rate-limit.md': SPEC_BODY } }),
        github: new MockGitHubClient(),
        // The feature default is openrouter; the mock stands in for it.
        llm: { openrouter: llm, openai: llm },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.prIntent).where(eq(t.prIntent.prId, prId));
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-original' })
      .where(eq(t.pullRequests.id, prId));
    llm.calls.length = 0;
  });

  const derive = (payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/pulls/${prId}/intent`, payload });

  const get = () => app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });

  /** The user message of the single structured call the classifier made. */
  const promptOf = (): string => {
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const req = call!.req as { messages: { role: string; content: string }[] };
    return req.messages.map((m) => m.content).join('\n');
  };

  it('persists a pr_intent row with head_sha, provider, model, sources and a tier', async () => {
    const res = await derive();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.intent).toBe('Add rate limiting to the public API endpoints.');
    expect(body.in_scope).toContain('a limiter on /api routes');
    expect(body.out_of_scope).toHaveLength(1);
    expect(body.head_sha).toBe('sha-original');
    expect(body.provider).toBe('openrouter');
    expect(body.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(body.generated_at).toBeTruthy();
    // Deterministic tier, not the model's self-rated 0.95.
    expect(body.confidence).toBe('high');
    expect(body.model_confidence).toBe(0.95);

    const [row] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    expect(row!.intent).toBe('Add rate limiting to the public API endpoints.');
    expect(row!.sources).toContain('pr_title_body');
  });

  it('sends the @@ HEADERS of the patch and NONE of its body', async () => {
    await derive();
    const prompt = promptOf();

    // The shape of the change is there …
    expect(prompt).toContain('@@ -1,3 +1,5 @@');
    expect(prompt).toContain('src/config.ts');
    // … and not one line of its content.
    expect(prompt).not.toContain('sk_live_INTENT_TEST');
    expect(prompt).not.toContain(SECRET_LINE);
    expect(prompt).not.toContain('const port = 3000');
    expect(prompt).not.toContain('const limiter = true');
    // Nor the section heading git appends to the hunk header, which is source.
    expect(prompt).not.toContain('export function config');
  });

  it('instructs the model to answer in English, whatever the PR is written in', async () => {
    await derive();
    // Asserted on the assembled messages rather than on the constant, because
    // the guarantee is that the instruction REACHES the model: `assemblePrompt`
    // is what decides which slot survives into `messages`.
    expect(promptOf()).toContain('Answer in ENGLISH');
  });

  it('takes a linked plan/spec into account, read through git.readFile', async () => {
    const res = await derive();
    expect(res.json().sources).toContain('linked_spec');
    expect(promptOf()).toContain('SPEC docs/plans/rate-limit.md');
    expect(promptOf()).toContain('Add a limiter to every public endpoint.');
  });

  it('a linked issue is fetched and labelled', async () => {
    const res = await derive();
    expect(res.json().sources).toContain('linked_issue');
    expect(promptOf()).toContain('ISSUE #42');
  });

  it('a second POST without force makes NO llm call and returns the cached row', async () => {
    await derive();
    const firstCalls = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(firstCalls).toBe(1);

    const again = await derive();
    expect(again.statusCode).toBe(200);
    // The cache is the point: the count must not move.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('force: true re-derives even when nothing moved', async () => {
    await derive();
    await derive({ force: true });
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
  });

  it('GET reports stale: true once the pull head_sha has moved', async () => {
    await derive();
    const fresh = await get();
    expect(fresh.json().stale).toBe(false);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-moved' })
      .where(eq(t.pullRequests.id, prId));

    const after = await get();
    expect(after.statusCode).toBe(200);
    expect(after.json().stale).toBe(true);
    expect(after.json().head_sha).toBe('sha-original');
  });

  it('GET is a 404 before anything has been derived', async () => {
    const res = await get();
    expect(res.statusCode).toBe(404);
  });

  it('discards an evidence label that was never presented', async () => {
    // Make `commit_messages` genuinely absent from the prompt, then have the
    // classifier claim it anyway. (The seed DOES create pr_commits rows, so
    // without this deletion the label would be legitimately present.)
    const commits = await pg.handle.db
      .select()
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId));
    await pg.handle.db.delete(t.prCommits).where(eq(t.prCommits.prId, prId));

    const liar = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentClassification: { ...CLASSIFICATION, evidence_used: ['commit_messages'] },
      },
    });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app2 = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: { 'docs/plans/rate-limit.md': SPEC_BODY } }),
        github: new MockGitHubClient(),
        llm: { openrouter: liar, openai: liar },
      },
    });
    try {
      const res = await app2.inject({
        method: 'POST',
        url: `/pulls/${prId}/intent`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sources).toEqual([]);
      // With no credited source and a substantive body, the tier is medium.
      expect(res.json().confidence).toBe('medium');
    } finally {
      await app2.close();
      if (commits.length > 0) await pg.handle.db.insert(t.prCommits).values(commits);
    }
  });

  /**
   * The DEGRADED CONTRACT, tested at the service rather than at its caller.
   *
   * `IntentFacade.ensure` states that it never throws (`modules/intent/types.ts`):
   * a missing key, a provider error, a GitHub failure or a bad model response
   * all return `null` and log. Its only production caller wraps the call in
   * `.catch(() => null)` as a CONTAINMENT boundary — `executeRuns` runs
   * un-awaited, so an escaping rejection would leave every queued run with no
   * status and no trace. That `.catch` also means the case in
   * `reviews.it.test.ts` would keep passing if this guarantee regressed: it
   * proves the caller survives a throwing facade, which is a different
   * property. So the guarantee is exercised here, directly on the service.
   *
   * `container.intent` with no `intent` override IS the real `IntentService`.
   */
  describe('the degraded contract — ensure NEVER throws', () => {
    /** A structural IntentSink that records what was logged. */
    function recordingSink() {
      const messages: string[] = [];
      return { messages, info: (m: string) => messages.push(m) };
    }

    async function ensureWith(
      overrides: NonNullable<Parameters<typeof buildApp>[0]['overrides']>,
      target: string = prId,
    ) {
      const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
      const isolated = await buildApp({ config, db: pg.handle.db, overrides });
      const sink = recordingSink();
      try {
        // No try/catch here ON PURPOSE: an unhandled rejection IS the failure
        // this test exists to catch.
        const res = await isolated.container.intent.ensure(workspaceId, target, { sink });
        return { res, messages: sink.messages };
      } finally {
        await isolated.close();
      }
    }

    const storedRows = () =>
      pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));

    const workingGit = () => new MockGitClient({ files: { 'docs/plans/rate-limit.md': SPEC_BODY } });

    it('returns null, and logs, when the provider call rejects', async () => {
      const { res, messages } = await ensureWith({
        git: workingGit(),
        github: new MockGitHubClient(),
        llm: { openrouter: new RejectingLLM('openai'), openai: new RejectingLLM('openai') },
      });

      expect(res).toBeNull();
      expect(messages.join('\n')).toContain('provider 503');
      // A failed derivation must leave NOTHING behind — a half-written row
      // would later read as a cached intent and suppress the retry.
      expect(await storedRows()).toHaveLength(0);
    });

    it("returns null when the model's answer fails IntentClassification", async () => {
      // What a repair-exhausted structured call does in production: throw.
      const badShape = new MockLLMProvider('openai', {
        structuredBySchema: { IntentClassification: { intent: 42, in_scope: 'not-an-array' } },
      });
      const { res, messages } = await ensureWith({
        git: workingGit(),
        github: new MockGitHubClient(),
        llm: { openrouter: badShape, openai: badShape },
      });

      expect(res).toBeNull();
      // Names the schema, so this is provably the validation path and not some
      // earlier failure returning null for an unrelated reason.
      expect(messages.join('\n')).toContain('schema');
      expect(await storedRows()).toHaveLength(0);
    });

    it('returns null when no API key is configured (the ConfigError path)', async () => {
      // MockSecretsProvider with NO keys: this is also what keeps the test off
      // the machine's real ~/.devdigest/secrets.json and off the network.
      const { res, messages } = await ensureWith({
        secrets: new MockSecretsProvider({}),
        git: workingGit(),
        github: new MockGitHubClient(),
        // No `llm` override at all — resolution itself must fail.
      });

      expect(res).toBeNull();
      expect(messages.join('\n')).toMatch(/OPENROUTER_API_KEY/);
      expect(await storedRows()).toHaveLength(0);
    });

    it('DEGRADES rather than failing when GitHub is unavailable', async () => {
      // The contract's other half: a GitHub failure must not propagate, and it
      // must not cost the whole derivation either. The intent is still derived
      // — only the `linked_issue` label is missing, because that source really
      // did not contribute.
      const llmOk = new MockLLMProvider('openai', {
        structuredBySchema: { IntentClassification: CLASSIFICATION },
      });
      const { res } = await ensureWith({
        git: workingGit(),
        github: new FailingIssuesGitHub(),
        llm: { openrouter: llmOk, openai: llmOk },
      });

      expect(res).not.toBeNull();
      expect(res!.record.sources).not.toContain('linked_issue');
      expect(res!.record.sources).toContain('pr_title_body');
      expect(await storedRows()).toHaveLength(1);
    });

    it('returns null for a PR that does not exist in this workspace', async () => {
      const llmOk = new MockLLMProvider('openai', {
        structuredBySchema: { IntentClassification: CLASSIFICATION },
      });
      const { res } = await ensureWith(
        { git: workingGit(), github: new MockGitHubClient(), llm: { openrouter: llmOk } },
        '00000000-0000-4000-8000-000000000000',
      );

      expect(res).toBeNull();
    });
  });
});
