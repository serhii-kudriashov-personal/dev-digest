import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toSyncError } from '../_shared/sync-error.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — polling module. MANUAL refresh that ONLY syncs the change-request list
 * (new/updated entries appear, head_sha updates). It does NOT trigger any
 * review — review is manual (user presses Run Review, owned by A2).
 *
 *   POST /repos/:id/poll  → sync the list from the repository's OWN forge,
 *                           bump last_polled_at
 *
 * SPEC-06 AC-42/AC-43 — THE UNIT OF FAILURE IS ONE REPOSITORY. The sync is
 * attempted per repository against `container.forge(repo)`, and a forge that
 * cannot be reached is reported as this repository's outcome rather than
 * thrown: every other repository, on every other instance, is untouched and
 * keeps a newer `last_polled_at`. `last_polled_at` is bumped ONLY on a
 * successful sync, so "when did this repository last actually sync" stays a
 * true answer (AC-42) and a failed attempt reads as a stale snapshot rather
 * than a fresh empty one (AC-44).
 *
 * The failure is PERSISTED as well as returned (`repos.last_sync_error`,
 * AC-44 / NFR-7). The poll response is seen by exactly one caller, at exactly
 * one moment; the read path that has to distinguish "stale after a failed
 * sync" from "empty project" is a later, unrelated request, and only a column
 * survives from one to the other.
 */
export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let pulls;
    try {
      const forge = await container.forge(repo);
      // `instanceKey` is not optional in practice — absent it selects the
      // legacy github.com layout, which for a non-github.com row is a DIFFERENT
      // repository (`@devdigest/shared` `RepoRef`).
      pulls = await forge.listPullRequests({
        owner: repo.owner,
        name: repo.name,
        instanceKey: repo.instanceKey,
      });
    } catch (err) {
      // One repository's forge being unreachable — or its credential missing,
      // which arrives as `ConfigError` and is a normal path — is this
      // repository's outcome, not a 500 and not another repository's problem
      // (AC-43). `last_polled_at` is deliberately NOT bumped.
      app.log.warn({ err, repoId: repo.id }, 'Forge sync failed for this repository');
      // PERSISTED, not just returned (AC-44, NFR-7): a later
      // `GET /repos/:id/pulls` serves the stale snapshot and must be able to
      // say WHY it is stale, which the poll RESPONSE alone can never tell it.
      // The message is third-party-influenced text, so it is capped and
      // credential-redacted first — the same value goes to the caller.
      const syncError = toSyncError(err);
      await container.db
        .update(t.repos)
        .set({ lastSyncError: syncError })
        .where(eq(t.repos.id, repo.id));
      return { synced: 0, reviewTriggered: false, sync_error: syncError };
    }

    let synced = 0;
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
      synced++;
    }
    // Only a SUCCESSFUL sync moves this repository's clock (AC-42) — and the
    // same write CLEARS any recorded failure, so `last_sync_error` describes
    // the LAST attempt rather than the last failure ever seen.
    await container.db
      .update(t.repos)
      .set({ lastPolledAt: new Date(), lastSyncError: null })
      .where(eq(t.repos.id, repo.id));

    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false, sync_error: null };
  });
}
