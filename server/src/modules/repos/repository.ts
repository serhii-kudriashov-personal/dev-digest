import { and, eq } from 'drizzle-orm';
import type { RepoProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — repos data-access layer. The ONLY place that touches the `repos`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface InsertRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
  /** SPEC-06 — identity beyond `owner/name`. */
  provider: RepoProvider;
  instanceId: string | null;
  instanceKey: string;
  namespacePath: string;
}

export class RepoRepository {
  constructor(private db: Db) {}

  /**
   * Find a repo by the identity the unique index enforces: workspace, owning
   * instance, and path within it (SPEC-06 AC-16). Two instances holding the
   * same namespace path are two different repositories, which is exactly what
   * the old `(workspace_id, full_name)` lookup could not express.
   */
  async findByIdentity(
    workspaceId: string,
    instanceKey: string,
    fullName: string,
  ): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(
        and(
          eq(t.repos.workspaceId, workspaceId),
          eq(t.repos.instanceKey, instanceKey),
          eq(t.repos.fullName, fullName),
        ),
      );
    return row;
  }

  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  /**
   * Insert the repository, or hand back the row that already holds its identity.
   *
   * `onConflictDoNothing()` + a re-select is what makes two concurrent
   * `POST /repos` of one URL settle on ONE row instead of one 201 and one 500
   * (NFR-9): the loser of the race sees no returned row, reads the winner's, and
   * reports `created: false`. The unique-violation is caught here rather than in
   * the service because it is a property of the index, and nothing
   * Drizzle-shaped crosses this boundary either way
   * (`backend-onion-architecture` §5).
   */
  async insert(values: InsertRepo): Promise<{ row: RepoRow; created: boolean }> {
    const [inserted] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        owner: values.owner,
        name: values.name,
        fullName: values.fullName,
        createdBy: values.createdBy,
        provider: values.provider,
        instanceId: values.instanceId,
        instanceKey: values.instanceKey,
        namespacePath: values.namespacePath,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { row: inserted, created: true };

    const existing = await this.findByIdentity(
      values.workspaceId,
      values.instanceKey,
      values.fullName,
    );
    if (!existing) throw new Error('repos insert conflicted with no matching row');
    return { row: existing, created: false };
  }

  /**
   * Look up the workspace owning a repo (by repo id, no tenancy scope —
   * the JobRunner's `runCloneJob` is the only caller and it already trusted
   * the payload that came out of an authenticated `add()`). Returns null
   * if the repo was deleted before the followup ran.
   */
  async workspaceIdFor(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.workspaceId ?? null;
  }

  /** Persist the clone path and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }
}
