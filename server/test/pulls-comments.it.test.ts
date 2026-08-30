/**
 * Inline review comments (Files changed tab) — GET/POST /pulls/:id/comments.
 * These proxy live to the repository's OWN forge, so we drive them through a
 * mock and assert the route resolves the PR, reflects existing comments, and
 * pins new comments to the PR's head sha. Gated on Docker (needs Postgres to
 * resolve the PR + repo rows), matching the other integration tests.
 *
 * SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) AC-23 widened an inline
 * comment's identity to a STRING for every provider, so the fixtures below use
 * `'1'` and `'42'` rather than `1` and `42`. That is the contract change
 * landing, not a defect: `PrCommentInput.in_reply_to` is `z.string()`, so a
 * numeric `in_reply_to` is now rejected by the route schema with a 422 before
 * the handler runs — which is exactly what this file caught.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockForgeClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { PrReviewComment } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoValues: Partial<typeof t.repos.$inferInsert> = {},
) {
  const name = `commented-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, ...repoValues })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

/**
 * GitHub's own comment id, as its adapter now emits it: `String(c.id)` (AC-23).
 * It stringifies without loss, so a GitHub id still reads as its integer.
 */
const EXISTING: PrReviewComment = {
  id: '1',
  path: 'src/config.ts',
  line: 11,
  original_line: 11,
  side: 'RIGHT',
  body: 'Why hardcode this key?',
  user: 'reviewer',
  created_at: '2026-06-01T00:00:00Z',
  html_url: 'https://github.com/acme/x/pull/7#discussion_r1',
  in_reply_to_id: null,
  is_outdated: false,
};

/**
 * GitLab's, from the same port: an opaque 40-hex discussion id that does NOT
 * reverse into an integer. The pair is the whole reason AC-23 chose a string —
 * a widened number could not carry this one.
 */
const GITLAB_DISCUSSION = '1a2b3c4d5e6f708192a3b4c5d6e7f80912345678';
const GITLAB_EXISTING: PrReviewComment = {
  id: GITLAB_DISCUSSION,
  path: 'src/config.ts',
  line: 11,
  original_line: 11,
  side: 'RIGHT',
  body: 'Same question over here.',
  user: 'ana.reyes',
  created_at: '2026-06-01T00:00:00Z',
  html_url: 'https://gitlab.example.com/acme/x/-/merge_requests/7#note_101',
  in_reply_to_id: null,
  is_outdated: false,
};

d('inline PR comments routes (Testcontainers pg)', () => {
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

  it('GET reflects existing GitHub review comments', async () => {
    const gh = new MockGitHubClient({ comments: [EXISTING] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/comments` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrReviewComment[];
    expect(body).toHaveLength(1);
    expect(body[0]!.body).toBe('Why hardcode this key?');
  });

  it('POST creates a comment pinned to the PR head sha', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'Please move this to an env var.' },
    });
    expect(res.statusCode).toBe(200);
    expect(gh.createdComments).toHaveLength(1);
    expect(gh.createdComments[0]).toMatchObject({
      commitId: 'deadbeef',
      path: 'src/config.ts',
      line: 11,
      body: 'Please move this to an env var.',
    });
    const created = res.json() as PrReviewComment;
    expect(created.path).toBe('src/config.ts');
    expect(created.line).toBe(11);
  });

  it('POST forwards a reply as in_reply_to', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'agreed', in_reply_to: '42' },
    });
    expect(res.statusCode).toBe(200);
    // Forwarded verbatim as a string — never `Number()`d back on the way past
    // the route, which is what would silently work for GitHub and destroy a
    // GitLab discussion id (AC-23).
    expect(gh.createdComments[0]).toMatchObject({ inReplyTo: '42' });
  });

  it('AC-23: a numeric in_reply_to is rejected by the route schema', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'agreed', in_reply_to: 42 },
    });

    // The identity is a string for EVERY provider, so the old integer shape is
    // a validation failure at the edge rather than something the adapter has to
    // guess about. Nothing was posted.
    expect(res.statusCode).toBe(422);
    expect(gh.createdComments).toHaveLength(0);
  });

  it('POST rejects an empty body as a validation error', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: '' },
    });
    // Zod parse failure → the app's validation status (422), nothing posted.
    expect(res.statusCode).toBe(422);
    expect(gh.createdComments).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-23 — string identity across BOTH providers, and a threaded reply
  // -------------------------------------------------------------------------

  /**
   * A registered instance plus a repository on it, as Stage B's import lands
   * them. The base URL is per-call because this file has no between-test wipe
   * and `git_instances` is unique on (workspace, base URL).
   */
  let instanceSeq = 0;
  async function setupGitLabPr() {
    const host = `gitlab-${instanceSeq++}.example.com`;
    const [instance] = await pg.handle.db
      .insert(t.gitInstances)
      .values({
        workspaceId,
        provider: 'gitlab',
        baseUrl: `https://${host}`,
        instanceKey: host,
        label: 'Acme GitLab',
        version: '17.4.1',
        edition: 'community',
        approvalCapability: 'unknown',
        verifiedAt: new Date(),
      })
      .returning();
    const setup = await setupRepoAndPr(pg.handle.db, workspaceId, {
      provider: 'gitlab',
      instanceId: instance!.id,
      instanceKey: host,
      namespacePath: 'acme/api',
    });
    return { ...setup, instanceKey: host };
  }

  it('AC-23: inline comment ids are strings for a GitHub PR and a GitLab MR alike', async () => {
    // GitHub, through its own client…
    const gh = new MockGitHubClient({ comments: [EXISTING] });
    const ghApp = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: gh },
    });
    const { pr: ghPr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ghRes = await ghApp.inject({ method: 'GET', url: `/pulls/${ghPr.id}/comments` });

    // …GitLab, through the provider-neutral forge.
    const forge = new MockForgeClient({ comments: [GITLAB_EXISTING] });
    const glApp = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { forge },
    });
    const { pr: glPr, instanceKey } = await setupGitLabPr();
    const glRes = await glApp.inject({ method: 'GET', url: `/pulls/${glPr.id}/comments` });

    expect([ghRes.statusCode, glRes.statusCode]).toEqual([200, 200]);

    // The route declares no response schema, so the ring-0 contract is checked
    // HERE or nowhere: `PrReviewComment.id` is `z.string()`, and a numeric id
    // from either adapter fails this parse rather than reaching a client.
    const ghComments = PrReviewComment.array().parse(ghRes.json());
    const glComments = PrReviewComment.array().parse(glRes.json());

    expect(typeof ghComments[0]!.id).toBe('string');
    expect(typeof glComments[0]!.id).toBe('string');

    // And the two shapes really are different values in one field — a GitHub
    // integer that stringifies losslessly, and a GitLab discussion id that does
    // not reverse into a number at all.
    expect(ghComments[0]!.id).toBe('1');
    expect(glComments[0]!.id).toBe(GITLAB_DISCUSSION);
    expect(Number.isNaN(Number(glComments[0]!.id))).toBe(true);

    // The GitLab read was made against the repository's OWN instance, not the
    // legacy github.com layout an absent `instanceKey` would select.
    expect(forge.calls[0]!.repo.instanceKey).toBe(instanceKey);
  });

  it('AC-23: a reply to a GitLab thread is posted into that thread', async () => {
    const forge = new MockForgeClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { forge } });
    const { pr } = await setupGitLabPr();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: {
        path: 'src/config.ts',
        line: 11,
        body: 'Fixed in 3f2a1b.',
        in_reply_to: GITLAB_DISCUSSION,
      },
    });
    expect(res.statusCode).toBe(200);

    // The thread id reaches the adapter unchanged. Anything that coerced it —
    // `Number()`, a parseInt, a slice — would address a different discussion or
    // none at all, and GitLab would open a NEW thread instead of replying.
    expect(forge.createdComments).toHaveLength(1);
    expect(forge.createdComments[0]!.input.inReplyTo).toBe(GITLAB_DISCUSSION);
    expect(forge.createdComments[0]!.n).toBe(pr.number);

    const created = PrReviewComment.parse(res.json());
    expect(created.in_reply_to_id).toBe(GITLAB_DISCUSSION);
    expect(typeof created.id).toBe('string');
  });
});
