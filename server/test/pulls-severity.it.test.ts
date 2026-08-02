/**
 * PR list severity rollup — the `findings_by_severity` field on
 * GET /repos/:id/pulls (specs/findings-by-severity.md).
 *
 * The interesting cases are all about DISTINGUISHING ABSENCES: never reviewed
 * (null) vs reviewed-and-clean (zeros), and counting across every run rather
 * than the latest one. That needs real rows in Postgres, so this is gated on
 * Docker like the other integration tests.
 *
 * NOTE: `N skipped` here means UNVERIFIED, not passing — read the test count,
 * not just the exit code (server/INSIGHTS.md, 2026-08-02).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('PR list findings_by_severity (Testcontainers pg)', () => {
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

  /** A repo with one PR, isolated from the seeded data and from other tests. */
  async function setupRepoAndPr() {
    const db = pg.handle.db;
    const name = `sev-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
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

  async function addReview(prId: string, severities: string[]) {
    const db = pg.handle.db;
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', verdict: 'comment', score: 70 })
      .returning();
    if (severities.length > 0) {
      await db.insert(t.findings).values(
        severities.map((severity, i) => ({
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: i + 1,
          endLine: i + 1,
          severity,
          category: 'bug',
          title: `finding ${i}`,
          rationale: 'because',
          confidence: 0.9,
        })),
      );
    }
    return review!;
  }

  async function listPulls(repoId: string): Promise<PrMeta[]> {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    return res.json() as PrMeta[];
  }

  it('is null for a PR that has never been reviewed', async () => {
    const { repo } = await setupRepoAndPr();
    const [row] = await listPulls(repo.id);
    expect(row!.findings_by_severity).toBeNull();
  });

  it('is an object of zeros — not null — for a reviewed PR with no findings', async () => {
    const { repo, pr } = await setupRepoAndPr();
    await addReview(pr.id, []);
    const [row] = await listPulls(repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it('tallies by severity using the shared uppercase keys', async () => {
    const { repo, pr } = await setupRepoAndPr();
    await addReview(pr.id, ['CRITICAL', 'CRITICAL', 'WARNING', 'SUGGESTION']);
    const [row] = await listPulls(repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('sums across EVERY review of the PR, not just the latest', async () => {
    const { repo, pr } = await setupRepoAndPr();
    await addReview(pr.id, ['CRITICAL', 'WARNING']);
    await addReview(pr.id, ['WARNING', 'SUGGESTION']);
    const [row] = await listPulls(repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 1 });
  });

  it('counts accepted and dismissed findings too', async () => {
    const { repo, pr } = await setupRepoAndPr();
    const review = await addReview(pr.id, ['CRITICAL', 'WARNING']);
    // Triage both — the column reports what the review FOUND, so the numbers
    // must not move.
    await pg.handle.db
      .update(t.findings)
      .set({ dismissedAt: new Date(), acceptedAt: new Date() })
      .where(eq(t.findings.reviewId, review.id));
    const [row] = await listPulls(repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
  });

  it('does not leak one PR\'s findings into another', async () => {
    const a = await setupRepoAndPr();
    const b = await setupRepoAndPr();
    await addReview(a.pr.id, ['CRITICAL', 'CRITICAL']);
    await addReview(b.pr.id, ['SUGGESTION']);
    const [rowA] = await listPulls(a.repo.id);
    const [rowB] = await listPulls(b.repo.id);
    expect(rowA!.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 0, SUGGESTION: 0 });
    expect(rowB!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 1 });
  });
});
