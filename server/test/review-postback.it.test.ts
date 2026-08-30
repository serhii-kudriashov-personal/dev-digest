import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, ne } from 'drizzle-orm';
import type { ReviewPostBack, ReviewPublicationResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockForgeClient } from '../src/adapters/mocks.js';
import { POST_BACK_NOTE_CAP } from '../src/modules/reviews/constants.js';
import type { ContainerOverrides } from '../src/platform/container.js';

/**
 * Posting a run's review back, end to end through the routes (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-39, AC-40, NFR-3, NFR-8,
 * NFR-12, and the workspace scoping every `:id` route owes).
 *
 * Ring 5 + ring 3 against a REAL Postgres, because every claim here is a
 * property of rows: the outcome is a `review_postbacks` row (that is what makes
 * NFR-12 true at all), the review to publish is selected by `(pr_id, run_id)`
 * after the pull is resolved workspace-scoped, and NFR-8's single-flight is
 * only observable when two requests genuinely race through the same service.
 * None of that exists without the database (`backend-onion-architecture` §9).
 *
 * `*.it.test.ts` is the CI split, and a SKIPPING suite exits 0 and reads as
 * passing — the run's COUNT is the evidence, never the exit code
 * (`server/INSIGHTS.md` 2026-08-02, 2026-08-03; run the lane with
 * `--no-file-parallelism`).
 *
 * WHY `MockForgeClient` AND NOT `MockGitHubClient`. GitHub's `createReview` is
 * ONE request, so `OctokitGitHubClient.publishReview` can only ever answer
 * `posted_verdict_applied` or `not_posted` — a mock modelled on it would leave
 * every degraded branch of this service unexercised while looking green.
 * `MockForgeClient` takes a SEEDED `publication` outcome for exactly that
 * reason (`server/INSIGHTS.md` 2026-08-28, 2026-08-29): a mock must model every
 * field the assertion discriminates on, or the test is a tautology.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Seeded by `seed()`; never touched by this file's wipe. */
const SEEDED_REPO = 'acme/payments-api';

d('posting a review back (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
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
    // Repos first: `repos.instance_id` is ON DELETE RESTRICT by design. Pulls,
    // reviews, findings and post-backs all cascade from here.
    await db.delete(t.repos).where(ne(t.repos.fullName, SEEDED_REPO));
    await db.delete(t.gitInstances);
  });

  const makeApp = async (overrides: ContainerOverrides): Promise<FastifyInstance> =>
    buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides,
    });

  /** A registered GitLab instance plus a repository that belongs to it. */
  async function gitlabRepo(over: { workspaceId?: string } = {}) {
    const ws = over.workspaceId ?? workspaceId;
    const host = `gitlab-${instanceSeq++}.example.com`;
    const [instance] = await pg.handle.db
      .insert(t.gitInstances)
      .values({
        workspaceId: ws,
        provider: 'gitlab',
        baseUrl: `https://${host}`,
        instanceKey: host,
        label: 'Acme GitLab',
        approvalCapability: 'unknown',
      })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'group/sub/team',
        fullName: 'group/sub/team/project',
        name: 'project',
        provider: 'gitlab',
        instanceId: instance!.id,
        instanceKey: instance!.instanceKey,
        namespacePath: 'group/sub/team/project',
      })
      .returning();
    return { instance: instance!, repo: repo! };
  }

  async function addPull(repoId: string, ws = workspaceId) {
    const [row] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId,
        number: 7,
        title: 'Add rate limiting to the public API',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'head-bbb',
        additions: 3,
        deletions: 1,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    return row!;
  }

  /** One completed run's review, with `count` findings to publish. */
  async function addReview(
    prId: string,
    opts: { count?: number; verdict?: string; ws?: string } = {},
  ) {
    const runId = randomUUID();
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        prId,
        agentId: null,
        runId,
        kind: 'review',
        verdict: opts.verdict ?? 'request_changes',
        summary: 'Two config values are hard-coded.',
        score: 72,
        model: 'mock-model',
      })
      .returning();
    const count = opts.count ?? 2;
    if (count > 0) {
      await pg.handle.db.insert(t.findings).values(
        Array.from({ length: count }, (_, i) => ({
          reviewId: review!.id,
          file: `src/f${String(i).padStart(2, '0')}.ts`,
          startLine: i + 1,
          endLine: i + 1,
          // Deliberately all SUGGESTION except the last, so the cap case below
          // has something the ordering must rescue.
          severity: i === count - 1 ? 'CRITICAL' : 'SUGGESTION',
          category: 'correctness',
          title: `Finding ${i}`,
          rationale: 'Because.',
          confidence: 0.9,
        })),
      );
    }
    return { runId, reviewId: review!.id };
  }

  const post = (app: FastifyInstance, prId: string, runId: string) =>
    app.inject({
      method: 'POST',
      url: `/pulls/${prId}/post-review`,
      payload: { run_id: runId },
    });

  const get = (app: FastifyInstance, prId: string, runId: string) =>
    app.inject({ method: 'GET', url: `/pulls/${prId}/post-review/${runId}` });

  // -------------------------------------------------------------------------
  // AC-39 / NFR-12 — the outcome is recorded, and survives being asked again
  // -------------------------------------------------------------------------

  it('AC-39/NFR-12: the POST records an outcome and the GET returns exactly what it recorded', async () => {
    const { repo, instance } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id, { count: 2 });
    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const posted = await post(app, pull.id, runId);
    expect(posted.statusCode).toBe(200);
    const body = posted.json() as ReviewPostBack;

    expect(body.outcome).toBe('posted_verdict_applied');
    expect(body.run_id).toBe(runId);
    expect(body.pr_id).toBe(pull.id);
    // Summary note + one note per finding.
    expect(body.notes_published).toBe(3);

    // The publication reached the forge as ONE call for this repository, and it
    // carried `instanceKey` — absent, that selects the legacy github.com layout,
    // which for this row is a DIFFERENT repository (root `INSIGHTS.md`
    // 2026-08-29).
    expect(forge.published).toHaveLength(1);
    expect(forge.published[0]!.repo).toEqual({
      owner: 'group/sub/team',
      name: 'project',
      instanceKey: instance.instanceKey,
    });
    expect(forge.published[0]!.n).toBe(7);
    expect(forge.published[0]!.payload.notes).toHaveLength(2);
    expect(forge.published[0]!.payload.verdict).toBe('request_changes');

    // NFR-12: a reload asks the GET, and gets the same row back — the outcome
    // was never only in the POST's response.
    const reloaded = await get(app, pull.id, runId);
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json()).toEqual(body);

    // And it is genuinely a row, not a memoised response.
    const rows = await pg.handle.db
      .select()
      .from(t.reviewPostbacks)
      .where(eq(t.reviewPostbacks.prId, pull.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId, outcome: 'posted_verdict_applied', notesPublished: 3 });

    await app.close();
  });

  it('NFR-12: a run that was never posted answers null rather than inventing an outcome', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id);
    const app = await makeApp({ forge: new MockForgeClient() });

    const res = await get(app, pull.id, runId);

    expect(res.statusCode).toBe(200);
    // "Never posted" is a distinct state from all four outcomes — a client that
    // could not tell it from `not_posted` would offer to retry a post that
    // never happened.
    expect(res.json()).toBeNull();

    await app.close();
  });

  // -------------------------------------------------------------------------
  // AC-40 — partially published, seeded because no mock can reach it by luck
  // -------------------------------------------------------------------------

  it('AC-40: a failure after ≥1 note landed is recorded as partially_published with its count', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id, { count: 3 });

    const seeded: Omit<ReviewPublicationResult, 'notesPublished'> & { notesPublished: number } = {
      outcome: 'partially_published',
      reason:
        '2 of 4 notes reached merge request !7 in group/sub/team/project before publication ' +
        'stopped. The verdict was not applied.',
      notesPublished: 2,
    };
    const forge = new MockForgeClient({ publication: seeded });
    const app = await makeApp({ forge });

    const body = (await post(app, pull.id, runId)).json() as ReviewPostBack;

    // Not a blanket failure: the service carries the forge's own three-part
    // answer through untouched.
    expect(body.outcome).toBe('partially_published');
    expect(body.notes_published).toBe(2);
    expect(body.reason).toContain('2 of 4 notes');

    // Distinguishable from BOTH neighbours, which is the whole of AC-40: a
    // complete post here would have been 4, and one that never started, 0.
    expect(body.notes_published).toBeGreaterThan(0);
    expect(body.notes_published).toBeLessThan(forge.published[0]!.payload.notes.length + 1);

    // NFR-12: the degraded state persists, not just the happy one.
    expect((await get(app, pull.id, runId)).json()).toEqual(body);

    await app.close();
  });

  it('AC-39: a forge that THROWS is recorded as not_posted, never as a 500', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id);
    // The whole instance is unreachable — `MockForgeClient` throws before it can
    // report anything, which is the path `container.forge`'s `ConfigError` also
    // takes. Seeded by `instanceKey`, which is the key the mock branches on and
    // the field the service must actually pass (root `INSIGHTS.md` 2026-08-29):
    // a service that dropped it would land on the mock's default seed and this
    // case would quietly assert the happy path instead.
    const forge = new MockForgeClient({
      byInstanceKey: { [repo.instanceKey]: { offline: 'connect ETIMEDOUT 203.0.113.10:443' } },
    });
    const app = await makeApp({ forge });

    const res = await post(app, pull.id, runId);
    const body = res.json() as ReviewPostBack;

    // The four outcomes ARE the answer (AC-39); a 500 would take the screen out
    // over a state the user is meant to read.
    expect(res.statusCode).toBe(200);
    expect(body.outcome).toBe('not_posted');
    expect(body.notes_published).toBe(0);
    expect(body.reason).toContain('ETIMEDOUT');
    expect(forge.published).toEqual([]);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // NFR-3 — the cap survives the whole route, and is stated to the user
  // -------------------------------------------------------------------------

  it('NFR-3: 25 findings publish 20 notes and the response SAYS what was truncated', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id, { count: 25 });
    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const body = (await post(app, pull.id, runId)).json() as ReviewPostBack;

    // The cap is applied where the payload is built, so what reaches the forge
    // is already capped — nothing downstream has to be trusted to re-apply it.
    expect(forge.published[0]!.payload.notes).toHaveLength(POST_BACK_NOTE_CAP);
    expect(body.notes_published).toBe(POST_BACK_NOTE_CAP + 1);

    // AC-40's ordering guarantee, observed through the route: the ONLY CRITICAL
    // is the last row inserted, so a cap applied in row order would drop it.
    expect(forge.published[0]!.payload.notes[0]!.body).toContain('CRITICAL');
    expect(forge.published[0]!.payload.notes[0]!.body).toContain('Finding 24');

    // NFR-3: the truncation is stated to the user, twice over — in the summary
    // note that reaches the merge request, and on the outcome they read here.
    expect(forge.published[0]!.payload.summary).toContain('Showing the 20 most severe of 25');
    expect(body.reason).toContain('Only the 20 most severe findings were posted');
    expect(body.reason).toContain('5 more remain in DevDigest');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // NFR-8 — two simultaneous posts publish at most ONE set of notes
  // -------------------------------------------------------------------------

  it('NFR-8: two concurrent posts of one run publish AT MOST ONE set of notes', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const { runId } = await addReview(pull.id, { count: 2 });

    const forge = new MockForgeClient();
    // Hold the first publication OPEN so the second request is genuinely still
    // in flight when it reaches the single-flight map. Without the gate the mock
    // answers synchronously, the two POSTs can serialise, and a green result
    // would prove nothing about concurrency — it would prove the mock is fast.
    //
    // `entered` is the anchor: the gate is not released until the first request
    // is provably parked INSIDE the forge, so the wait below only has to cover
    // the second request's own database reads.
    const inner = forge.publishReview.bind(forge);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const firstEntered = new Promise<void>((r) => (entered = r));
    forge.publishReview = async (r, n, payload) => {
      entered();
      await gate;
      return inner(r, n, payload);
    };

    const app = await makeApp({ forge });

    const both = Promise.all([post(app, pull.id, runId), post(app, pull.id, runId)]);
    await firstEntered;
    await new Promise((r) => setTimeout(r, 100));
    release();
    const [a, b] = await both;

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    // THE assertion. Two 200s prove nothing on their own — a second publication
    // would also answer 200, having put a duplicate summary note and a duplicate
    // note per finding on the merge request.
    expect(forge.published).toHaveLength(1);

    // Both callers observe the same recorded outcome, and only one row exists.
    expect(a.json()).toEqual(b.json());
    const rows = await pg.handle.db
      .select()
      .from(t.reviewPostbacks)
      .where(eq(t.reviewPostbacks.prId, pull.id));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('NFR-8: the single flight is per (run, pull) — a second RUN is not collapsed into the first', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const first = await addReview(pull.id, { count: 1 });
    const second = await addReview(pull.id, { count: 1 });
    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const a = (await post(app, pull.id, first.runId)).json() as ReviewPostBack;
    const b = (await post(app, pull.id, second.runId)).json() as ReviewPostBack;

    // Two different runs are unconstrained — collapsing them would silently
    // refuse to publish a re-run's review.
    expect(forge.published).toHaveLength(2);
    expect(a.run_id).toBe(first.runId);
    expect(b.run_id).toBe(second.runId);

    const rows = await pg.handle.db
      .select()
      .from(t.reviewPostbacks)
      .where(eq(t.reviewPostbacks.prId, pull.id));
    expect(rows).toHaveLength(2);

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Workspace scoping — the `:id` and the `run_id` are both attacker-controlled
  // -------------------------------------------------------------------------

  it('another workspace’s pull request is a plain 404, and publishes nothing', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-postback-ws-${randomUUID()}` })
      .returning();
    const { repo } = await gitlabRepo({ workspaceId: otherWs!.id });
    const foreignPull = await addPull(repo.id, otherWs!.id);
    const { runId } = await addReview(foreignPull.id, { ws: otherWs!.id });

    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const posted = await post(app, foreignPull.id, runId);
    const read = await get(app, foreignPull.id, runId);

    expect(posted.statusCode).toBe(404);
    expect(read.statusCode).toBe(404);
    // Nothing was published and nothing was recorded on the way to the 404.
    expect(forge.published).toEqual([]);
    expect(await pg.handle.db.select().from(t.reviewPostbacks)).toEqual([]);

    await app.close();
  });

  it('a run_id belonging to ANOTHER pull request selects nothing, even in this workspace', async () => {
    // `reviewForRun` filters on `(pr_id, run_id)` AFTER the pull is resolved
    // workspace-scoped, so a caller who knows a run id cannot use it to publish
    // that run's review onto a change request it does not belong to.
    const { repo } = await gitlabRepo();
    const mine = await addPull(repo.id);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-run-ws-${randomUUID()}` })
      .returning();
    const foreign = await gitlabRepo({ workspaceId: otherWs!.id });
    const foreignPull = await addPull(foreign.repo.id, otherWs!.id);
    const foreignRun = await addReview(foreignPull.id, { ws: otherWs!.id });

    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const res = await post(app, mine.id, foreignRun.runId);

    expect(res.statusCode).toBe(404);
    expect(forge.published).toEqual([]);
    expect(await pg.handle.db.select().from(t.reviewPostbacks)).toEqual([]);

    await app.close();
  });

  it('a run with no review is a 404, not a post-back recording an empty publication', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const res = await post(app, pull.id, randomUUID());

    expect(res.statusCode).toBe(404);
    expect(forge.published).toEqual([]);
    expect(await pg.handle.db.select().from(t.reviewPostbacks)).toEqual([]);

    await app.close();
  });

  it('a non-uuid run id is refused at the edge, before the handler runs', async () => {
    const { repo } = await gitlabRepo();
    const pull = await addPull(repo.id);
    const forge = new MockForgeClient();
    const app = await makeApp({ forge });

    const posted = await post(app, pull.id, 'not-a-uuid');
    const read = await get(app, pull.id, 'not-a-uuid');

    expect(posted.statusCode).toBe(422);
    expect(read.statusCode).toBe(422);
    expect(forge.published).toEqual([]);

    await app.close();
  });
});
