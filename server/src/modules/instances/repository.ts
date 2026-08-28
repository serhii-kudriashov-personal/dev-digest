import { and, asc, eq } from 'drizzle-orm';
import type { ApprovalCapability, RepoProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * All `git_instances` SQL (SPEC-06). Constructor takes `Db`, never the
 * container; every method takes `workspaceId` and scopes on it, because the
 * `:id` in the URL is attacker-controlled (`security` §A01,
 * `backend-onion-architecture` §5). Rows and plain DTO-shaped inputs cross this
 * boundary — nothing Drizzle-shaped does.
 */

export type GitInstanceRow = typeof t.gitInstances.$inferSelect;

export interface InsertInstanceInput {
  provider: RepoProvider;
  baseUrl: string;
  instanceKey: string;
  label: string;
  version: string | null;
  edition: string | null;
  approvalCapability: ApprovalCapability;
  verifiedAt: Date | null;
  createdBy: string | null;
}

export interface VerificationPatch {
  label?: string;
  version: string | null;
  edition: string | null;
  approvalCapability: ApprovalCapability;
  verifiedAt: Date | null;
}

export class InstancesRepository {
  constructor(private db: Db) {}

  /** Every instance in the workspace, oldest first (explicit `ORDER BY` — a
   *  list feeding a view with none reshuffles, `server/INSIGHTS.md` 2026-08-21). */
  async list(workspaceId: string): Promise<GitInstanceRow[]> {
    return this.db
      .select()
      .from(t.gitInstances)
      .where(eq(t.gitInstances.workspaceId, workspaceId))
      .orderBy(asc(t.gitInstances.createdAt));
  }

  async findById(workspaceId: string, id: string): Promise<GitInstanceRow | null> {
    const [row] = await this.db
      .select()
      .from(t.gitInstances)
      .where(and(eq(t.gitInstances.workspaceId, workspaceId), eq(t.gitInstances.id, id)));
    return row ?? null;
  }

  async findByBaseUrl(workspaceId: string, baseUrl: string): Promise<GitInstanceRow | null> {
    const [row] = await this.db
      .select()
      .from(t.gitInstances)
      .where(and(eq(t.gitInstances.workspaceId, workspaceId), eq(t.gitInstances.baseUrl, baseUrl)));
    return row ?? null;
  }

  /**
   * Create the instance, or return the one already registered at this base URL.
   *
   * `onConflictDoNothing()` with no target covers BOTH unique indexes — base
   * URL and derived key — so a second registration is a normal answer rather
   * than a 500. The caller decides what to do with `created: false`; today it
   * refreshes the existing row's verification and rotates its stored token.
   */
  async insert(
    workspaceId: string,
    input: InsertInstanceInput,
  ): Promise<{ row: GitInstanceRow; created: boolean }> {
    const [inserted] = await this.db
      .insert(t.gitInstances)
      .values({
        workspaceId,
        provider: input.provider,
        baseUrl: input.baseUrl,
        instanceKey: input.instanceKey,
        label: input.label,
        version: input.version,
        edition: input.edition,
        approvalCapability: input.approvalCapability,
        verifiedAt: input.verifiedAt,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { row: inserted, created: true };

    const existing = await this.findByBaseUrl(workspaceId, input.baseUrl);
    if (existing) return { row: existing, created: false };

    // The conflict was on the derived key rather than on the base URL — two
    // different base URLs collapsing onto one clone-path segment. Surface the
    // row that already owns the key so the caller can name it.
    const [byKey] = await this.db
      .select()
      .from(t.gitInstances)
      .where(
        and(
          eq(t.gitInstances.workspaceId, workspaceId),
          eq(t.gitInstances.instanceKey, input.instanceKey),
        ),
      );
    if (!byKey) throw new Error('git_instances insert conflicted with no matching row');
    return { row: byKey, created: false };
  }

  /** Record what a successful verification learned. */
  async recordVerification(
    workspaceId: string,
    id: string,
    patch: VerificationPatch,
  ): Promise<GitInstanceRow | null> {
    const [row] = await this.db
      .update(t.gitInstances)
      .set({
        ...(patch.label === undefined ? {} : { label: patch.label }),
        version: patch.version,
        edition: patch.edition,
        approvalCapability: patch.approvalCapability,
        verifiedAt: patch.verifiedAt,
      })
      .where(and(eq(t.gitInstances.workspaceId, workspaceId), eq(t.gitInstances.id, id)))
      .returning();
    return row ?? null;
  }

  /** `true` when a row was removed, `false` when none matched the workspace. */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.gitInstances)
      .where(and(eq(t.gitInstances.workspaceId, workspaceId), eq(t.gitInstances.id, id)))
      .returning({ id: t.gitInstances.id });
    return rows.length > 0;
  }
}
