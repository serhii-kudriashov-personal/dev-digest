import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type {
  PrMeta,
  PrDetail,
  ForgeClient,
  PrReviewComment,
  SeverityCounts,
} from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toSyncError } from '../_shared/sync-error.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { deriveReviewStatus, rollupSeverities } from './status.js';

/**
 * F1 — pulls module. Change-request import (list + per-request detail).
 *   GET /repos/:id/pulls → list change requests for a repo, synced from the
 *                          repository's OWN forge and persisted. `status` is the
 *                          forge's merge state (open/merged/closed).
 *   GET /pulls/:id       → full detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 *
 * SPEC-06: every outbound call resolves through `container.forge(repo)`, so a
 * GitLab repository reaches its own instance and a GitHub one reaches
 * github.com, with no branch on the provider anywhere in this file. The
 * local-first `try/catch` shape is UNCHANGED and load-bearing: a forge failure
 * serves the persisted snapshot rather than failing the read (AC-44). What the
 * failure now also does is RECORD itself in `repos.last_sync_error`, which is
 * what lets a reader tell that snapshot apart from an empty project — the read
 * itself still answers 200 with whatever is on disk.
 *
 * NOTE for anyone copying this file: its ~25 Drizzle-in-ring-5 sites are
 * catalogued debt, not precedent (`backend-onion-architecture` §12).
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  /**
   * The `RepoRef` a repository row names. `instanceKey` is not optional in
   * practice — absent it selects the legacy github.com layout, which for a
   * non-github.com row is a DIFFERENT repository (`@devdigest/shared` `RepoRef`,
   * root `INSIGHTS.md` 2026-08-29).
   */
  const refFor = (repo: typeof t.repos.$inferSelect) => ({
    owner: repo.owner,
    name: repo.name,
    instanceKey: repo.instanceKey,
  });

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    /**
     * Record the outcome of this read's sync attempt in `repos.last_sync_error`
     * (AC-44, NFR-7), so the persisted snapshot below can be told apart from an
     * empty project by a consumer that only ever sees this response. Written
     * only when it CHANGES: an offline workspace would otherwise take a write
     * on every poll of every repository for a value that is already correct.
     *
     * Never throws: this is a diagnostic on a local-first read, so failing to
     * record why the sync failed must not fail the read as well.
     */
    const recordSyncOutcome = async (value: string | null): Promise<void> => {
      if (repo.lastSyncError === value) return;
      try {
        await container.db
          .update(t.repos)
          .set({ lastSyncError: value })
          .where(eq(t.repos.id, repo.id));
        repo.lastSyncError = value;
      } catch (err) {
        app.log.warn({ err, repoId: repo.id }, 'Could not record the forge sync outcome');
      }
    };

    let gh: ForgeClient | null = null;
    try {
      gh = await container.forge(repo);
    } catch (err) {
      // ConfigError from the resolver is a normal path (no token, instance
      // credential missing) — never a 500. It is still a failed sync attempt,
      // so it is recorded: capped and credential-redacted first, because the
      // message is third-party-influenced text.
      app.log.warn({ err }, 'Forge client unavailable (no token / offline); serving persisted PRs');
      await recordSyncOutcome(toSyncError(err));
    }

    // Local-first: sync from the forge when it resolved, but never fail the
    // read — already-imported/seeded change requests stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests(refFor(repo));
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
        // The sync reached the forge and the snapshot below is fresh — clear
        // any failure a previous attempt recorded, so the column describes the
        // LAST attempt and not the last failure ever seen.
        await recordSyncOutcome(null);
      } catch (err) {
        app.log.warn({ err }, 'Forge sync skipped (no token / offline); serving persisted PRs');
        await recordSyncOutcome(toSyncError(err));
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on either forge's list payload, so freshly-imported
    // rows land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest(refFor(repo), r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Latest-review SCORE per PR for the list's score ring. Computed on read
    // from reviews (no FK denorm); the list is small, so one IN-query + JS
    // grouping is cheap.
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { score: number | null }>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({ prId: t.reviews.prId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per PR is the latest review.
      for (const rv of reviewRows) {
        if (!latestReviewByPr.has(rv.prId)) latestReviewByPr.set(rv.prId, { score: rv.score });
      }
    }

    // TOTAL cost per PR for the list's cost column: every run ever made against
    // the PR, summed. The column answers "what have I spent on this PR so far",
    // so re-running an agent ADDS to it rather than replacing it — a much-
    // iterated PR is genuinely more expensive and should read that way.
    //
    // Runs with a null cost (failed, or pre-dating the cost restore) are
    // filtered out in SQL rather than coerced to 0, so they contribute nothing
    // and a PR whose runs ALL lack cost keeps an empty map entry → "—" rather
    // than a false "$0.0000".
    const totalCostByPr = new Map<string, number>();
    if (prIds.length > 0) {
      const runRows = await container.db
        .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), isNotNull(t.agentRuns.costUsd)));
      for (const run of runRows) {
        if (run.prId) {
          totalCostByPr.set(run.prId, (totalCostByPr.get(run.prId) ?? 0) + run.costUsd!);
        }
      }
    }

    // FINDINGS per severity for the list's findings column: every finding of
    // every review of the PR, tallied. Same "all runs" reading as the cost
    // column above, and the same union the PR detail page renders — a re-run
    // ADDS to the breakdown rather than replacing it.
    //
    // A PR with no reviews gets no map entry at all, so it renders "—"
    // (never reviewed), which is distinct from a reviewed PR that produced no
    // findings and gets an object of zeros.
    const severitiesByPr = new Map<string, SeverityCounts>();
    if (prIds.length > 0) {
      const findingRows = await container.db
        .select({ prId: t.reviews.prId, severity: t.findings.severity })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(inArray(t.reviews.prId, prIds));
      const byPr = new Map<string, { severity: string }[]>();
      for (const f of findingRows) {
        const list = byPr.get(f.prId);
        if (list) list.push(f);
        else byPr.set(f.prId, [f]);
      }
      // Reviewed-but-clean PRs have no finding rows, so seed from the reviews
      // we already fetched — otherwise they'd be indistinguishable from
      // never-reviewed and render "—".
      for (const prId of latestReviewByPr.keys()) {
        severitiesByPr.set(prId, rollupSeverities(byPr.get(prId) ?? []));
      }
      for (const [prId, list] of byPr) {
        if (!severitiesByPr.has(prId)) severitiesByPr.set(prId, rollupSeverities(list));
      }
    }

    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        cost_usd: totalCostByPr.get(r.id) ?? null,
        findings_by_severity: severitiesByPr.get(r.id) ?? null,
      };
    });
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from the owning forge when it resolves;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so detail works offline.
    try {
      const gh = await container.forge(repo);
      const detail = await gh.getPullRequest(refFor(repo), pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on either forge's list payload — backfill them
          // from the detail fetch so the list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      app.log.warn({ err }, 'Forge detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to the owning forge (no local persistence): GET reflects
  // existing comments; POST creates one immediately. Keeps the tab in lock-step
  // with the forge and avoids a stale local mirror. Comment ids are strings for
  // every provider (AC-23) — GitHub's integers are stringified inside its own
  // adapter, so nothing here knows which forge answered.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: ForgeClient;
      try {
        gh = await container.forge(repo);
      } catch (err) {
        app.log.warn({ err }, 'Forge client unavailable; serving no inline comments');
        return [];
      }
      try {
        return await gh.listReviewComments(refFor(repo), pr.number);
      } catch (err) {
        app.log.warn({ err }, 'Forge review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: ForgeClient;
      try {
        gh = await container.forge(repo);
      } catch (err) {
        // ConfigError from the resolver — a missing GitHub token, or an
        // instance whose access token is not stored. Its message already names
        // the instance (AC-45), so it is surfaced rather than replaced.
        const msg =
          err instanceof Error
            ? err.message
            : 'Connect an access token for this repository to post comments.';
        throw new AppError('forge_unavailable', msg, 400);
      }
      try {
        return await gh.createReviewComment(refFor(repo), pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // A forge rejects comments on lines outside the diff / on closed
        // change requests (GitHub 422, GitLab 400).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment.';
        throw new AppError('forge_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );
}
