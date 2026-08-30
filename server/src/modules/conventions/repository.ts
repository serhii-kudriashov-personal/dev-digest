import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';

/**
 * Conventions data-access. Owns `conventions` and `convention_scans`, and reads
 * `repos` for the clone lookup the pipeline needs.
 *
 * That last one matters: the reference build ran the repo lookup from its pipeline
 * file, which is ring 2. It escaped `no-sql-in-service` only because the rule
 * matches by filename — this is the honest placement.
 *
 * Workspace-scoped throughout.
 */

export type ConventionRow = typeof t.conventions.$inferSelect;
export type ConventionScanRow = typeof t.conventionScans.$inferSelect;

export interface RepoClone {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
  /**
   * Carried so the `RepoRef` this slice builds resolves to the clone this row
   * actually owns — a bare `{ owner, name }` from a non-github.com row reads
   * another workspace's mirror (SPEC-06 AC-17; `@devdigest/shared` `RepoRef`).
   */
  instanceKey: string;
}

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  category: ConventionCategory;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceLineStart: number;
  evidenceLineEnd: number;
  confidence: number;
}

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  filesSampled: number;
  candidates: number;
  dropped: number;
  provider: string;
  model: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async findRepo(workspaceId: string, repoId: string): Promise<RepoClone | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
        instanceKey: t.repos.instanceKey,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Oldest first — the list renders in insertion order, never by confidence. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(asc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async getManyById(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  /** Rules already judged for this repo — the dedup set a re-scan must not re-propose. */
  async judgedRules(workspaceId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ rule: t.conventions.rule })
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          ne(t.conventions.status, 'pending'),
        ),
      );
    return rows.map((r) => r.rule);
  }

  /**
   * Replace the not-yet-judged candidates for a repo. Accepted AND rejected rows
   * survive — that is the whole point of the tri-state column.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    rows: InsertConvention[],
  ): Promise<ConventionRow[]> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      );
    if (rows.length > 0) {
      await this.db.insert(t.conventions).values(rows.map((r) => ({ ...r, status: 'pending' as const })));
    }
    return this.listForRepo(workspaceId, repoId);
  }

  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rule })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async setStatus(
    workspaceId: string,
    ids: string[],
    status: ConventionStatus,
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .update(t.conventions)
      .set({ status })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)))
      .returning();
  }

  async insertScan(values: InsertScan): Promise<ConventionScanRow> {
    const [row] = await this.db.insert(t.conventionScans).values(values).returning();
    return row!;
  }

  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }
}
