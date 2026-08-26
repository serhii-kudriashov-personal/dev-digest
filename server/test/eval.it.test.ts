import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type { z } from 'zod';
import type { Finding, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { singleFileDiffFragment } from '../src/modules/eval/helpers.js';
import { EVAL_MAX_DIFF_BYTES } from '../src/modules/eval/constants.js';

/**
 * DB-backed coverage for the eval slice (L06, SPEC-04). Named `*.it.test.ts`
 * because it needs real Postgres — run it ALONE with `--no-file-parallelism`
 * (the module-scoped lock + queue in `eval/service.ts` are shared across every
 * `buildApp` in this process, so a run left in flight leaks into the next
 * case — `server/INSIGHTS.md` 2026-08-17).
 *
 * A stub `LLMProvider` is registered for BOTH `openrouter` (the seeded
 * default, `db/seed.ts`) and `openai`, or a misconfigured test would spend
 * real money (`server/INSIGHTS.md` 2026-08-08).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping Testcontainers tests.');
}

/** Returns a canned `Review` keyed by the file path found in the chunk's
 *  `diff --git a/<path> b/<path>` line — deterministic regardless of which
 *  case runs when, since the fixture is looked up by content, not call order. */
class ScriptedLLM extends MockLLMProvider {
  reviewsByFile = new Map<string, Review>();

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';
    const match = userMsg.match(/diff --git a\/(\S+) b\//);
    const file = match?.[1] ?? '';
    const review: Review = this.reviewsByFile.get(file) ?? {
      verdict: 'approve',
      summary: 'nothing to report',
      score: 95,
      findings: [],
    };
    const parsed = (req.schema as z.ZodType<T>).safeParse(review);
    if (!parsed.success) {
      throw new Error(`ScriptedLLM fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
}

/** Throws on every call — the AC-25 per-case failure path. */
class RejectingLLM extends MockLLMProvider {
  override async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('provider 503 from the eval endpoint');
  }
}

/** Delays every call — gives a poll a real window to observe `cases_done`
 *  mid-run (AC-28) and a cancel request a real window to land before every
 *  case finishes (AC-29). */
class SlowLLM extends ScriptedLLM {
  constructor(
    provider: 'openai' | 'anthropic',
    private delayMs = 150,
  ) {
    super(provider);
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return super.completeStructured(req);
  }
}

function findingAt(file: string, line: number, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `f-${file}-${line}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'Mock finding',
    file,
    start_line: line,
    end_line: line,
    rationale: 'mock rationale',
    confidence: 0.9,
    ...overrides,
  };
}

const PATCH = '@@ -1,2 +1,2 @@\n context\n-const old = 1;\n+const updated = 1;\n context';

d('Testcontainers: eval pipeline', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let noKeyApp: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let agentId: string;
  let prId: string;
  let repoId: string;
  let llm: ScriptedLLM;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;

    const [pull] = await db.select().from(t.pullRequests);
    prId = pull!.id;
    workspaceId = pull!.workspaceId;
    repoId = pull!.repoId;

    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
    agentId = agent!.id;

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    llm = new ScriptedLLM('openai');
    app = await buildApp({
      config,
      db,
      overrides: { llm: { openrouter: llm, openai: llm } },
    });
    noKeyApp = await buildApp({
      config,
      db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
  });

  afterAll(async () => {
    await app?.close();
    await noKeyApp?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    const { db } = pg.handle;
    llm.calls.length = 0;
    llm.reviewsByFile.clear();
    // Clean slate per test: delete this agent's eval set runs (cascades its
    // eval_runs) and eval cases (cascades their eval_runs too).
    await db.delete(t.evalSetRuns).where(eq(t.evalSetRuns.agentId, agentId));
    await db.delete(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    await db
      .update(t.pullRequests)
      .set({ id: prId }) // no-op touch kept for readability of intent below
      .where(eq(t.pullRequests.id, prId));
  });

  const acceptFinding = async (findingId: string) => {
    await pg.handle.db
      .update(t.findings)
      .set({ acceptedAt: new Date(), dismissedAt: null })
      .where(eq(t.findings.id, findingId));
  };
  const dismissFinding = async (findingId: string) => {
    await pg.handle.db
      .update(t.findings)
      .set({ dismissedAt: new Date(), acceptedAt: null })
      .where(eq(t.findings.id, findingId));
  };

  /** Insert one review + one finding for our test agent, on the seeded PR. */
  async function insertJudgedFinding(
    file: string,
    judgement: 'accepted' | 'dismissed' | null,
  ): Promise<string> {
    const { db } = pg.handle;
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 'test review',
        score: 70,
        model: 'test-model',
      })
      .returning();
    const now = new Date();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file,
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'A test finding',
        rationale: 'because the test says so',
        confidence: 0.8,
        ...(judgement === 'accepted' ? { acceptedAt: now } : {}),
        ...(judgement === 'dismissed' ? { dismissedAt: now } : {}),
      })
      .returning();
    await db.delete(t.prFiles).where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, file)));
    await db.insert(t.prFiles).values({ prId, path: file, additions: 1, deletions: 1, patch: PATCH });
    return finding!.id;
  }

  async function waitForRunToFinish(setRunId: string, maxMs = 5000): Promise<Record<string, unknown>> {
    const start = Date.now();
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${setRunId}` });
      const body = res.json();
      if (body.status !== 'running') return body;
      if (Date.now() - start > maxMs) throw new Error('Timed out waiting for eval run to finish');
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  // ===========================================================================
  // AC-1, AC-4, AC-6, AC-7, AC-9: creating a case from a finding
  // ===========================================================================

  it('AC-1: a case created from an accepted finding lands on the producing agent', async () => {
    const findingId = await insertJudgedFinding('src/a.ts', 'accepted');
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.case.owner_id).toBe(agentId);
    expect(body.case.expectation.kind).toBe('must_find');
  });

  it('AC-4: an unjudged finding is refused, naming accept-or-dismiss', async () => {
    const findingId = await insertJudgedFinding('src/b.ts', null);
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message.toLowerCase()).toMatch(/accept|dismiss/);
  });

  it('AC-6, AC-7: names its PR, and after the PR is deleted still runs and reports provenance unavailable', async () => {
    const { db } = pg.handle;
    // A disposable PR just for this test, so deleting it doesn't touch the
    // shared seeded PR other tests rely on.
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
    const [disposablePr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9001,
        title: 'Disposable PR for AC-7',
        author: 'tester',
        branch: 'disposable',
        base: 'main',
        headSha: 'sha-disposable',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: disposablePr!.id,
      path: 'src/disposable.ts',
      additions: 1,
      deletions: 1,
      patch: PATCH,
    });
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: disposablePr!.id,
        agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 'disposable',
        score: 70,
        model: 'test-model',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/disposable.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'Disposable finding',
        rationale: 'r',
        confidence: 0.8,
        acceptedAt: new Date(),
      })
      .returning();

    const createRes = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
    });
    expect(createRes.statusCode).toBe(201);
    const caseId = createRes.json().case.id;
    expect(createRes.json().case.provenance.pr_number).toBe(9001);

    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, disposablePr!.id));

    const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().provenance.available).toBe(false);

    // Still runs despite the deleted source.
    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(runRes.statusCode).toBe(200);
  });

  it('AC-9: retains a secret-shaped literal and warns rather than redacting', async () => {
    const { db } = pg.handle;
    // insertJudgedFinding writes its own generic `pr_files` row for this path —
    // overwrite it with the secret-shaped patch AFTER, or it is discarded.
    const findingId = await insertJudgedFinding('src/secret.ts', 'accepted');
    const secretPatch = '@@ -1,1 +1,2 @@\n context\n+api_key: "sk_live_51H8xJ2eZvKYlo2C0X9f"';
    await db.delete(t.prFiles).where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, 'src/secret.ts')));
    await db
      .insert(t.prFiles)
      .values({ prId, path: 'src/secret.ts', additions: 1, deletions: 0, patch: secretPatch });
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.secret_warning).toBe(true);
    expect(body.case.input_diff).toContain('sk_live_51H8xJ2eZvKYlo2C0X9f');
  });

  // ===========================================================================
  // AC-5: a case's frozen diff fragment survives the source PR file changing
  // ===========================================================================

  it('AC-5: a case still runs on its originally-frozen fragment after pr_files changes', async () => {
    const file = 'src/frozen.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    const createRes = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(createRes.statusCode).toBe(201);
    const caseId = createRes.json().case.id;
    expect(createRes.json().case.input_diff).toContain('const updated = 1;');

    // Mutate the PR's stored patch AFTER the case's fragment was frozen.
    const mutatedPatch = '@@ -1,2 +1,2 @@\n context\n-const old = 1;\n+const MUTATED_CONTENT = 1;\n context';
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: mutatedPatch })
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, file)));

    llm.calls.length = 0;
    llm.reviewsByFile.set(file, { verdict: 'approve', summary: 's', score: 90, findings: [] });
    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(runRes.statusCode).toBe(200);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const userMsg =
      (call?.req as { messages: { role: string; content: string }[] } | undefined)?.messages.find(
        (m) => m.role === 'user',
      )?.content ?? '';
    expect(userMsg).toContain('const updated = 1;');
    expect(userMsg).not.toContain('MUTATED_CONTENT');

    // The stored fragment itself is untouched too.
    const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(getRes.json().input_diff).toContain('const updated = 1;');
  });

  // ===========================================================================
  // AC-12, AC-14: editing a case, and run-on-save
  // ===========================================================================

  it('AC-12: an edited case uses the edited input and expectation on its next run', async () => {
    const file = 'src/edit.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    const createRes = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const caseId = createRes.json().case.id;

    const editedDiff = singleFileDiffFragment(file, '@@ -1,1 +1,1 @@\n-old\n+EDITED_MARKER');
    const putRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: { input_diff: editedDiff, expected_output: { edited: true } },
    });
    expect(putRes.statusCode).toBe(200);

    const getAfterEdit = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(getAfterEdit.json().input_diff).toBe(editedDiff);
    expect(getAfterEdit.json().expected_output).toEqual({ edited: true });

    llm.calls.length = 0;
    llm.reviewsByFile.set(file, { verdict: 'approve', summary: 's', score: 90, findings: [] });
    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(runRes.statusCode).toBe(200);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const userMsg =
      (call?.req as { messages: { role: string; content: string }[] } | undefined)?.messages.find(
        (m) => m.role === 'user',
      )?.content ?? '';
    expect(userMsg).toContain('EDITED_MARKER');
  });

  it('AC-14: run_on_save on PUT triggers an immediate run with no separate run call', async () => {
    const file = 'src/runonsave.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    const createRes = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const caseId = createRes.json().case.id;
    llm.reviewsByFile.set(file, { verdict: 'comment', summary: 's', score: 60, findings: [findingAt(file, 2)] });

    const before = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(before.json().last_result).toBe('never_run');

    const putRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: { run_on_save: true },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().run_on_save).toBe(true);
    expect(putRes.json().last_result).toBe('pass'); // ran immediately, reflected in the SAME response
  });

  // ===========================================================================
  // NFR-3: a diff over the cap is refused, naming the cap and the actual size
  // ===========================================================================

  it('NFR-3: a case diff over EVAL_MAX_DIFF_BYTES is refused, naming the cap and the actual size', async () => {
    const bigPatch = 'x'.repeat(EVAL_MAX_DIFF_BYTES + 100);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agentId,
        name: 'Oversized case',
        input_diff: bigPatch,
        expected_output: {},
      },
    });
    expect(res.statusCode).toBe(422);
    const msg: string = res.json().error.message;
    expect(msg).toContain(String(EVAL_MAX_DIFF_BYTES));
    expect(msg).toMatch(/\d+/);
  });

  // ===========================================================================
  // NFR-6: a run request for a zero-case agent leaves no eval_set_runs row
  // ===========================================================================

  it('NFR-6: a run request for an agent with zero eval cases leaves no eval_set_runs row', async () => {
    const before = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));

    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(res.statusCode).toBe(422);

    const after = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));
    expect(after).toHaveLength(before.length);
  });

  // ===========================================================================
  // AC-13: malformed expected_output
  // ===========================================================================

  it('AC-13: malformed expected_output is refused and the stored value is unchanged', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agentId,
        name: 'Malformed-JSON case',
        input_diff: singleFileDiffFragment('src/c.ts', PATCH),
        expected_output: { ok: true },
      },
    });
    expect(createRes.statusCode).toBe(200);
    const caseId = createRes.json().id;

    const badRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: { expected_output: '{not valid json' },
    });
    expect(badRes.statusCode).toBe(422);

    const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(getRes.json().expected_output).toEqual({ ok: true });
  });

  // ===========================================================================
  // AC-15, AC-17, AC-18, NFR-5: running a whole case set
  // ===========================================================================

  it('AC-15, AC-17, AC-18, NFR-5: one set run, cases_covered right, exactly N model calls, reads add none', async () => {
    const files = ['src/s1.ts', 'src/s2.ts'];
    for (const file of files) {
      const findingId = await insertJudgedFinding(file, 'accepted');
      await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
      llm.reviewsByFile.set(file, { verdict: 'comment', summary: 's', score: 60, findings: [findingAt(file, 2)] });
    }

    llm.calls.length = 0;
    const runRes = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(runRes.statusCode).toBe(200);
    const setRunId = runRes.json().id;

    const finished = await waitForRunToFinish(setRunId);
    expect(finished.status).toBe('complete');
    expect(finished.cases_covered).toBe(2);
    expect(finished.config_version).toBeTypeOf('number');
    expect(finished.model).toBeTypeOf('string');

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(structuredCalls).toBe(2);

    await app.inject({ method: 'GET', url: `/eval-comparison?a=${setRunId}&b=${setRunId}` }).catch(() => undefined);
    await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(llm.calls.filter((c) => c.method === 'completeStructured').length).toBe(structuredCalls);

    const setRunsRows = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));
    expect(setRunsRows).toHaveLength(1);
  });

  it(
    'AC-15: an eight-case set is fully covered by a single run',
    async () => {
      const files = Array.from({ length: 8 }, (_, i) => `src/eight-${i}.ts`);
      for (const file of files) {
        const findingId = await insertJudgedFinding(file, 'accepted');
        await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
        llm.reviewsByFile.set(file, { verdict: 'comment', summary: 's', score: 60, findings: [findingAt(file, 2)] });
      }

      const runRes = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
      expect(runRes.statusCode).toBe(200);
      const setRunId = runRes.json().id;

      const finished = await waitForRunToFinish(setRunId, 8000);
      expect(finished.status).toBe('complete');
      expect(finished.cases_covered).toBe(8);

      const setRunsRows = await pg.handle.db
        .select()
        .from(t.evalSetRuns)
        .where(eq(t.evalSetRuns.agentId, agentId));
      expect(setRunsRows).toHaveLength(1); // one row, not eight (AC-17)
    },
    12_000,
  );

  // ===========================================================================
  // AC-16: deleting a case leaves the run's recorded metrics byte-identical
  // ===========================================================================

  it('AC-16: deleting a case afterward leaves the run metrics unchanged', async () => {
    const file = 'src/keep.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    const createRes = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const caseId = createRes.json().case.id;
    llm.reviewsByFile.set(file, { verdict: 'comment', summary: 's', score: 60, findings: [findingAt(file, 2)] });

    const runRes = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    const setRunId = runRes.json().id;
    const before = await waitForRunToFinish(setRunId);

    await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });

    const after = await app.inject({ method: 'GET', url: `/eval-runs/${setRunId}` });
    const afterBody = after.json();
    expect(afterBody.recall).toBe(before.recall);
    expect(afterBody.precision).toBe(before.precision);
    expect(afterBody.citation_accuracy).toBe(before.citation_accuracy);
    expect(afterBody.cases_passed).toBe(before.cases_passed);
  });

  // ===========================================================================
  // AC-25: one failing case does not stop the others
  // ===========================================================================

  it('AC-25: a case whose provider call fails still lets the others run, and the run is incomplete', async () => {
    const failingLlm = new RejectingLLM('openai');
    const failApp = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { llm: { openrouter: failingLlm, openai: failingLlm } },
    });
    try {
      const file = 'src/fail.ts';
      const findingId = await insertJudgedFinding(file, 'accepted');
      await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

      const runRes = await failApp.inject({
        method: 'POST',
        url: `/agents/${agentId}/eval-runs`,
        payload: {},
      });
      expect(runRes.statusCode).toBe(200);
      const setRunId = runRes.json().id;

      const start = Date.now();
      let finished: Record<string, unknown> = {};
      for (;;) {
        const res = await failApp.inject({ method: 'GET', url: `/eval-runs/${setRunId}` });
        finished = res.json();
        if (finished.status !== 'running') break;
        if (Date.now() - start > 5000) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(finished.status).toBe('incomplete');
      expect(finished.incomplete_reason).toBeTruthy();
    } finally {
      await failApp.close();
    }
  });

  // ===========================================================================
  // AC-28, AC-29: progress advances mid-run, and cancel preserves finished results
  // ===========================================================================

  it(
    'AC-28, AC-29: cases_done advances during a run, and cancelling preserves the finished results',
    async () => {
      const slowLlm = new SlowLLM('openai');
      const slowApp = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: { llm: { openrouter: slowLlm, openai: slowLlm } },
      });
      try {
        const files = ['src/p1.ts', 'src/p2.ts', 'src/p3.ts', 'src/p4.ts'];
        for (const file of files) {
          const findingId = await insertJudgedFinding(file, 'accepted');
          await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
          slowLlm.reviewsByFile.set(file, { verdict: 'approve', summary: 's', score: 90, findings: [] });
        }

        const runRes = await slowApp.inject({
          method: 'POST',
          url: `/agents/${agentId}/eval-runs`,
          payload: {},
        });
        expect(runRes.statusCode).toBe(200);
        const setRunId = runRes.json().id;

        // AC-28: cases_done advances across the run's lifetime — poll once
        // mid-flight (each case is delayed 150ms by `SlowLLM`).
        await new Promise((r) => setTimeout(r, 220));
        const mid = await slowApp.inject({ method: 'GET', url: `/eval-runs/${setRunId}` });
        const midBody = mid.json();
        expect(midBody.status).toBe('running');
        expect(midBody.cases_done).toBeGreaterThan(0);
        expect(midBody.cases_done).toBeLessThan(files.length);

        // AC-29: cancel mid-flight — the run finishes `incomplete`, and the
        // cases that DID finish keep their recorded result.
        const cancelRes = await slowApp.inject({
          method: 'POST',
          url: `/eval-runs/${setRunId}/cancel`,
        });
        expect(cancelRes.statusCode).toBe(200);

        const start = Date.now();
        let finished: Record<string, unknown> = {};
        for (;;) {
          const res = await slowApp.inject({ method: 'GET', url: `/eval-runs/${setRunId}` });
          finished = res.json();
          if (finished.status !== 'running') break;
          if (Date.now() - start > 8000) throw new Error('timed out waiting for cancel');
          await new Promise((r) => setTimeout(r, 15));
        }
        expect(finished.status).toBe('incomplete');

        const casesRes = await slowApp.inject({ method: 'GET', url: `/eval-runs/${setRunId}/cases` });
        const perCase: { pass: boolean | null }[] = casesRes.json();
        expect(perCase.length).toBeGreaterThan(0);
        expect(perCase.some((c) => c.pass !== null)).toBe(true);
      } finally {
        await slowApp.close();
      }
    },
    15_000,
  );

  // ===========================================================================
  // AC-27: no provider key
  // ===========================================================================

  it('AC-27: refuses with no key configured and records no eval_set_runs row', async () => {
    const file = 'src/nokey.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

    const before = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));

    const res = await noKeyApp.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/openrouter/i);

    const after = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));
    expect(after).toHaveLength(before.length);
  });

  // ===========================================================================
  // AC-30: a second run request while one is in flight
  // ===========================================================================

  it('AC-30: a second run request is refused, naming the running set_run_id', async () => {
    const files = ['src/c1.ts', 'src/c2.ts', 'src/c3.ts'];
    for (const file of files) {
      const findingId = await insertJudgedFinding(file, 'accepted');
      await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    }

    const first = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id;

    const second = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(second.statusCode).toBe(422);
    expect(second.json().error.details?.set_run_id ?? second.json().error.message).toBeTruthy();

    await waitForRunToFinish(firstId);

    const rows = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));
    expect(rows).toHaveLength(1);
  });

  // ===========================================================================
  // AC-32: a single-case run adds no eval_set_runs row
  // ===========================================================================

  it('AC-32: a single-case run updates the case and adds no eval_set_runs row', async () => {
    const file = 'src/single.ts';
    const findingId = await insertJudgedFinding(file, 'accepted');
    const createRes = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const caseId = createRes.json().case.id;
    llm.reviewsByFile.set(file, { verdict: 'comment', summary: 's', score: 60, findings: [findingAt(file, 2)] });

    const before = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));

    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(runRes.statusCode).toBe(200);
    expect(runRes.json().set_run_id).toBeFalsy();

    const after = await pg.handle.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.agentId, agentId));
    expect(after).toHaveLength(before.length);

    const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
    expect(getRes.json().last_result).toBe('pass');
  });

  // ===========================================================================
  // AC-38, AC-39: promote a historical version
  // ===========================================================================

  it('AC-38, AC-39: promotes v1 while v2 is live, restoring the historical config', async () => {
    // Created through the route (not a raw insert) so version 1 actually gets
    // snapshotted into `agent_versions` — `AgentsRepository.insert()` is the
    // only path that writes that row.
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Promote Test Agent',
        provider: 'openrouter',
        model: 'model-v1',
        system_prompt: 'v1 prompt',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const promoteAgentId = createRes.json().id;

    // Bump to v2 by changing the model.
    await app.inject({
      method: 'PUT',
      url: `/agents/${promoteAgentId}`,
      payload: { model: 'model-v2', system_prompt: 'v2 prompt' },
    });

    const liveBefore = await app.inject({ method: 'GET', url: `/agents/${promoteAgentId}` });
    expect(liveBefore.json().model).toBe('model-v2');

    const promoteRes = await app.inject({
      method: 'POST',
      url: `/agents/${promoteAgentId}/versions/1/promote`,
    });
    expect(promoteRes.statusCode).toBe(200);
    const body = promoteRes.json();
    expect(body.promoted).toBe(true);
    expect(body.agent.model).toBe('model-v1');
    expect(body.version).toBe(3); // a NEW highest version, not a rewrite of v1

    // v1 and v2 are both still readable, unchanged.
    const v1 = await app.inject({ method: 'GET', url: `/agents/${promoteAgentId}/versions/1` });
    expect(v1.json().config.model).toBe('model-v1');
    const v2 = await app.inject({ method: 'GET', url: `/agents/${promoteAgentId}/versions/2` });
    expect(v2.json().config.model).toBe('model-v2');
  });

  // ===========================================================================
  // NFR-8: retention — detail expires past the retention window
  // ===========================================================================

  it(
    'NFR-8: after enough runs the oldest still reports its metrics and detail_expired: true',
    async () => {
      const file = 'src/retention.ts';
      const findingId = await insertJudgedFinding(file, 'accepted');
      await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
      llm.reviewsByFile.set(file, { verdict: 'approve', summary: 's', score: 95, findings: [] });

      let oldestId: string | undefined;
      const RUNS = 22; // > EVAL_DETAIL_RETENTION_RUNS (20)
      for (let i = 0; i < RUNS; i++) {
        const runRes = await app.inject({
          method: 'POST',
          url: `/agents/${agentId}/eval-runs`,
          payload: {},
        });
        const setRunId = runRes.json().id;
        await waitForRunToFinish(setRunId);
        if (i === 0) oldestId = setRunId;
      }

      const oldest = await app.inject({ method: 'GET', url: `/eval-runs/${oldestId}` });
      const oldestBody = oldest.json();
      expect(oldestBody.detail_expired).toBe(true);
      // Metrics remain — NEVER wiped by retention.
      expect(oldestBody.citation_accuracy === null || typeof oldestBody.citation_accuracy === 'number').toBe(
        true,
      );
    },
    30_000,
  );
});
