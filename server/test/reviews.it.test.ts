import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

/** An intent facade that always reports "none derived" and performs no I/O. */
const nullIntent = () => ({
  async get() {
    return null;
  },
  async ensure() {
    return null;
  },
});

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // Needed since L03: a review run now derives PR intent as shared
        // pre-work. Left real, that reaches BOTH api.github.com (the seeded
        // body says "Closes #471") and the OpenRouter API (the `review_intent`
        // feature default) whenever those keys are configured — which they are
        // in server/.env. A test must never touch the network, and never spend
        // money. These tests are about skills and prompt assembly, so intent is
        // stubbed to "none"; the L03 block below overrides it with real blocks
        // to assert the wiring.
        intent: nullIntent(),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    // L01 cost badge: the engine's accumulated costUsd is persisted on the run,
    // mirrored into the trace document, and served on the run-history endpoint.
    // The mock LLM bills 0.001 per call, and DIFF touches a single file, so
    // 'auto' picks single-pass ⇒ exactly one call ⇒ 0.001.
    expect(run!.costUsd).toBeCloseTo(0.001, 6);
    expect(trace.stats.cost_usd).toBeCloseTo(0.001, 6);
    const runList = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runList[0].cost_usd).toBeCloseTo(0.001, 6);

    await app.close();
  });

  it('the PR-list cost column SUMS every run against the PR, not just the latest', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec-sum', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    // Two separate reviews of the SAME PR — a re-run must ADD to the total.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    // No GitHub token in tests → the list route falls back to persisted rows.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const row = pulls.find((p: { id: string }) => p.id === pr.id);
    // 2 runs × 0.001 each. The superseded "latest run only" rule would report
    // 0.001 here — this assertion is what pins the sum semantics.
    expect(row.cost_usd).toBeCloseTo(0.002, 6);

    await app.close();
  });

  it('a PR whose runs all lack a cost stays null (never 0)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // An `anthropic` agent with only `openai` mocked → ConfigError → failed run
    // with cost_usd NULL. Summing must not coerce that absence into 0.
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Broken-sum', provider: 'anthropic', model: 'claude-x', system_prompt: 'x' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const row = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(row.cost_usd).toBeNull();

    await app.close();
  });

  it('a failed run records cost_usd = NULL, not 0', async () => {
    // Only the `openai` provider is mocked, so an `anthropic` agent falls
    // through to container.llm('anthropic') → ConfigError (no key) → failed run.
    const app = await appWith(REVIEW_FIXTURE, 'openai');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Broken', provider: 'anthropic', model: 'claude-x', system_prompt: 'x' },
      })
    ).json();

    const body = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('failed');
    // The distinction the UI depends on: null renders "—" (unknown), whereas 0
    // would render "$0.0000" and claim the run was free.
    expect(run!.costUsd).toBeNull();

    const runList = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runList[0].cost_usd).toBeNull();

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  /**
   * L02 — the wire that closes the gap root INSIGHTS.md recorded: `assemblePrompt`
   * always built a `## Skills / rules` section, but the executor never passed
   * `skills`, so the trace recorded `{skills: null}` as a literal.
   *
   * These three cases pin the whole contract: an ENABLED linked skill reaches the
   * prompt in `agent_skills.order`, a DISABLED one does not, and an agent with no
   * skills produces the pre-L02 prompt unchanged.
   */
  describe('linked skills reach the assembled prompt', () => {
    async function runWithSkills(
      app: Awaited<ReturnType<typeof buildApp>>,
      skillIds: string[],
    ): Promise<{
      skills: string | null;
      tokenCounts: Record<string, number> | undefined;
      runId: string;
    }> {
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: {
            name: `Skilled ${Math.random().toString(36).slice(2, 8)}`,
            provider: 'openai',
            model: 'gpt-4.1',
            system_prompt: 'base prompt',
          },
        })
      ).json();

      if (skillIds.length > 0) {
        await app.inject({
          method: 'POST',
          url: `/agents/${agent.id}/skills`,
          payload: { skill_ids: skillIds },
        });
      }

      const body = (
        await app.inject({
          method: 'POST',
          url: `/pulls/${pr.id}/review`,
          payload: { agentId: agent.id },
        })
      ).json();
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (
        await app.inject({ method: 'GET', url: `/runs/${body.runs[0].run_id}/trace` })
      ).json();
      return {
        skills: trace.prompt_assembly.skills ?? null,
        tokenCounts: trace.prompt_assembly.token_counts,
        runId: body.runs[0].run_id,
      };
    }

    async function makeSkill(
      app: Awaited<ReturnType<typeof buildApp>>,
      name: string,
      body: string,
      enabled = true,
    ): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name, body, enabled, type: 'custom' },
      });
      return res.json().id;
    }

    it('an agent with no linked skills assembles no skills block', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { skills, tokenCounts } = await runWithSkills(app, []);
      expect(skills).toBeNull();
      // Omitted, not zero — a section that never existed has no cost to report.
      expect(tokenCounts && 'skills' in tokenCounts).toBe(false);
      await app.close();
    });

    it('enabled skills land in the block in agent_skills order, with a token count', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const first = await makeSkill(app, 'l02-first', '## FIRST\nReport a WARNING.');
      const second = await makeSkill(app, 'l02-second', '## SECOND\nReport a WARNING.');

      // Linked deliberately second-then-first: order is the ordering the user
      // dragged, not the order the skills were created in.
      const { skills, tokenCounts } = await runWithSkills(app, [second, first]);
      expect(skills).toContain('## SECOND');
      expect(skills).toContain('## FIRST');
      expect(skills!.indexOf('## SECOND')).toBeLessThan(skills!.indexOf('## FIRST'));
      expect(tokenCounts?.skills).toBeGreaterThan(0);
      await app.close();
    });

    it('a DISABLED skill stays linked but contributes no prompt block', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const on = await makeSkill(app, 'l02-on', '## KEPT\nReport a WARNING.');
      const off = await makeSkill(app, 'l02-off', '## DROPPED\nReport a WARNING.', false);

      const { skills } = await runWithSkills(app, [on, off]);
      expect(skills).toContain('## KEPT');
      // `skills.enabled` is the gate the executor filters on.
      expect(skills).not.toContain('## DROPPED');
      await app.close();
    });

    it('records one run_skills row per ENABLED skill, with its version and order', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const a = await makeSkill(app, 'l02-rs-a', '## A');
      const b = await makeSkill(app, 'l02-rs-b', '## B');
      const off = await makeSkill(app, 'l02-rs-off', '## OFF', false);

      const { runId } = await runWithSkills(app, [b, a, off]);

      const rows = await pg.handle.db
        .select()
        .from(t.runSkills)
        .where(eq(t.runSkills.runId, runId));
      // The disabled skill stays LINKED but contributes nothing, so it is not
      // part of what the run was given.
      expect(rows).toHaveLength(2);
      const byOrder = [...rows].sort((x, y) => x.order - y.order);
      expect(byOrder.map((r) => r.skillId)).toEqual([b, a]);
      // Version is recorded so a past run stays reproducible against the exact
      // body it was scored with.
      expect(byOrder.every((r) => r.version === 1)).toBe(true);
      await app.close();
    });

    it('a run with no skills writes no run_skills rows', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { runId } = await runWithSkills(app, []);
      expect(
        await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId)),
      ).toHaveLength(0);
      await app.close();
    });

    it('keeps an attribution naming a skill that WAS injected', async () => {
      const skillName = 'l02-attributed';
      const app = await appWith({
        ...REVIEW_FIXTURE,
        findings: [{ ...REVIEW_FIXTURE.findings[0], skill: skillName }],
      });
      const id = await makeSkill(app, skillName, '## Attributed');
      const { runId } = await runWithSkills(app, [id]);

      const rows = await pg.handle.db
        .select({ skillId: t.findings.skillId })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .where(eq(t.reviews.runId, runId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.skillId).toBe(id);
      await app.close();
    });

    it('DISCARDS an attribution naming a skill that was NOT injected', async () => {
      // The gate: a self-reported slug is checked against what the server put in
      // the prompt. `findings.confidence` returning 1.0 for a hallucination (root
      // INSIGHTS) is exactly why this cannot be trusted unvalidated.
      const app = await appWith({
        ...REVIEW_FIXTURE,
        findings: [{ ...REVIEW_FIXTURE.findings[0], skill: 'never-injected-anywhere' }],
      });
      const id = await makeSkill(app, 'l02-present', '## Present');
      const { runId } = await runWithSkills(app, [id]);

      const rows = await pg.handle.db
        .select({ skillId: t.findings.skillId })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .where(eq(t.reviews.runId, runId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.skillId).toBeNull();
      await app.close();
    });

    it('leaves a finding the model did not attribute unattributed', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const id = await makeSkill(app, 'l02-unattributed', '## Body');
      const { runId } = await runWithSkills(app, [id]);
      const rows = await pg.handle.db
        .select({ skillId: t.findings.skillId })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .where(eq(t.reviews.runId, runId));
      expect(rows[0]!.skillId).toBeNull();
      await app.close();
    });

    it('accept_rate stays NULL until a finding is judged, then reflects the judgement', async () => {
      const skillName = 'l02-rate';
      const app = await appWith({
        ...REVIEW_FIXTURE,
        findings: [{ ...REVIEW_FIXTURE.findings[0], skill: skillName }],
      });
      const id = await makeSkill(app, skillName, '## Rate');
      const { runId } = await runWithSkills(app, [id]);

      const before = (await app.inject({ method: 'GET', url: `/skills/${id}/stats` })).json();
      // A skill nobody has judged is not a skill with 0% acceptance.
      expect(before.accept_rate).toBeNull();
      expect(before.runs_count).toBe(1);
      expect(before.findings_last_30d).toBe(1);
      expect(before.findings_by_category).toHaveProperty('security');

      const [finding] = await pg.handle.db
        .select({ id: t.findings.id })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
        .where(eq(t.reviews.runId, runId));
      await pg.handle.db
        .update(t.findings)
        .set({ acceptedAt: new Date() })
        .where(eq(t.findings.id, finding!.id));

      const after = (await app.inject({ method: 'GET', url: `/skills/${id}/stats` })).json();
      expect(after.accept_rate).toBe(1);
      await app.close();
    });

    it('every enabled skill disabled ⇒ no block at all, as if none were linked', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const off = await makeSkill(app, 'l02-all-off', '## NONE\nReport a WARNING.', false);
      const { skills } = await runWithSkills(app, [off]);
      expect(skills).toBeNull();
      await app.close();
    });
  });

  describe('L03 — the derived intent reaches the prompt', () => {
    /**
     * A stub facade. `container.intent` is the sanctioned cross-slice channel,
     * so overriding it is also the test seam — no DB row and no LLM call for
     * the intent itself is involved here.
     */
    function intentStub(promptBlock: string | null, opts: { throws?: boolean } = {}) {
      const record = {
        pr_id: 'stub',
        intent: 'Add rate limiting.',
        in_scope: ['limiter'],
        out_of_scope: [],
        confidence: 'high' as const,
        sources: ['pr_title_body' as const],
      };
      return {
        async get() {
          return null;
        },
        async ensure() {
          if (opts.throws) throw new Error('intent blew up');
          return promptBlock === null ? null : { record, promptBlock, stale: false };
        },
      };
    }

    function appWithIntent(intent: ReturnType<typeof intentStub>) {
      return buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
          intent,
        },
      });
    }

    /**
     * Wait until THIS run's trace has actually been written.
     *
     * Deliberately neither `waitForPrRuns` nor a wait on run status. Both are
     * racy for a trace assertion, for the SAME structural reason:
     * `completeAgentRun` marks the run terminal BEFORE `saveRunTrace` persists
     * the document, so "the run is done" does not imply "the trace exists" —
     * which is what makes `trace.prompt_assembly` intermittently undefined
     * (server/INSIGHTS.md, 2026-08-05). Waiting on the row we are about to
     * assert on cannot race.
     */
    async function waitForTrace(runId: string, timeoutMs = 10_000) {
      const start = Date.now();
      for (;;) {
        const [row] = await pg.handle.db
          .select()
          .from(t.runTraces)
          .where(eq(t.runTraces.runId, runId));
        if (row) return row;
        if (Date.now() - start > timeoutMs) return row;
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    async function runAndTrace(app: Awaited<ReturnType<typeof buildApp>>) {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: {
            name: `l03-agent-${repo.id.slice(0, 8)}`,
            provider: 'openai',
            model: 'gpt-4.1',
            system_prompt: 'review',
          },
        })
      ).json();

      const body = (
        await app.inject({
          method: 'POST',
          url: `/pulls/${pr.id}/review`,
          payload: { agentId: agent.id },
        })
      ).json();
      const runId = body.runs[0].run_id;
      await waitForTrace(runId);
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      return { trace, runId };
    }

    it('an intent block lands in prompt_assembly AND is token-attributed', async () => {
      const app = await appWithIntent(intentStub('Add rate limiting to /api.'));
      const { trace } = await runAndTrace(app);
      expect(trace.prompt_assembly.intent).toBe('Add rate limiting to /api.');
      expect(trace.prompt_assembly.user).toContain('## PR intent (derived)');
      // The second edit `promptTokenCounts` needs — without its row this is
      // silently absent and looks like a trace that predates the feature.
      expect(trace.prompt_assembly.token_counts.intent).toBeGreaterThan(0);
      await app.close();
    });

    it('no intent ⇒ prompt_assembly.intent is null and the run completes normally', async () => {
      const app = await appWithIntent(intentStub(null));
      const { trace } = await runAndTrace(app);
      expect(trace.prompt_assembly.intent ?? null).toBeNull();
      expect(trace.prompt_assembly.user).not.toContain('## PR intent (derived)');
      expect(trace.prompt_assembly.token_counts.intent).toBeUndefined();
      await app.close();
    });

    it('an ensure() that THROWS still lets the review run to completion', async () => {
      // The degraded contract, end to end: intent is enrichment, never a
      // dependency, so a broken derivation must not fail a review.
      const app = await appWithIntent(intentStub(null, { throws: true }));
      const { trace, runId } = await runAndTrace(app);
      const [row] = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, runId));
      expect(row!.status).toBe('done');
      expect(trace.prompt_assembly.intent ?? null).toBeNull();
      await app.close();
    });
  });
});
