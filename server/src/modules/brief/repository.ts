import { and, eq } from 'drizzle-orm';
import { StoredRiskBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';

/**
 * PR Risk Brief data-access. The ONLY file in this slice that may import
 * Drizzle — `pipeline.ts` and `service.ts` take rows as parameters.
 *
 * Nothing Drizzle-shaped crosses the boundary — rows and plain DTOs only.
 * `getPull` is workspace-scoped and is the ownership check for the whole
 * feature (AC-6); `getRepo`/`getPrFiles` are keyed off a `prId`/`repoId`
 * already proven to belong to the caller's workspace, same pattern as
 * `intent/repository.ts`.
 */

export interface BriefRepoRow {
  owner: string;
  name: string;
  /**
   * Carried so the `RepoRef` this slice builds resolves to the clone this row
   * actually owns — a bare `{ owner, name }` from a non-github.com row reads
   * another workspace's mirror (SPEC-06 AC-17; `@devdigest/shared` `RepoRef`).
   */
  instanceKey: string;
  /**
   * The three fields `container.forge(repo)` resolves an outbound client from
   * (SPEC-06). Carried on the row rather than looked up again, so this slice
   * never branches on a provider itself — `workspaceId` is here because the
   * instance lookup behind the resolver is workspace-scoped.
   */
  workspaceId: string;
  provider: string;
  instanceId: string | null;
}

export interface BriefPrFileRow {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** The pull, scoped to the workspace so one tenant can never derive another's. */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<BriefRepoRow | undefined> {
    const [row] = await this.db
      .select({
        owner: t.repos.owner,
        name: t.repos.name,
        instanceKey: t.repos.instanceKey,
        workspaceId: t.repos.workspaceId,
        provider: t.repos.provider,
        instanceId: t.repos.instanceId,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  /**
   * Files for the PR. `patch` is consumed ONLY by `helpers.ts#changedRanges`
   * to derive line ranges — no raw hunk body ever leaves this slice (AC-8).
   */
  async getPrFiles(prId: string): Promise<BriefPrFileRow[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
        patch: t.prFiles.patch,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /**
   * The stored brief, or `undefined` on a mismatch. `safeParse`, never
   * `parse` — a document this feature did not write (there is no other
   * writer today, but the column is shared) must degrade to "no brief", never
   * a 500 (`zod` §parse-use-safeparse).
   */
  async getBrief(prId: string): Promise<StoredRiskBrief | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;
    const parsed = StoredRiskBrief.safeParse(row.json);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * Insert-or-replace the brief for a PR (NFR-8: one brief per PR, no version
   * history). Shape copied from `intent/repository.ts#upsertIntent`.
   */
  async upsertBrief(prId: string, doc: StoredRiskBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: doc })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: doc } });
  }
}
