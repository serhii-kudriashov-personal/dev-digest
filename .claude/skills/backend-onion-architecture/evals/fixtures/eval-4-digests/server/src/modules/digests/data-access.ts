import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { DigestRow } from '../../db/rows.js';

/**
 * L07 — digests data layer. Owns the `digests` table. Every query is
 * workspace-scoped.
 */
export class DigestStore {
  constructor(private db: Db) {}

  async listForWorkspace(workspaceId: string, limit: number): Promise<DigestRow[]> {
    return this.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.workspaceId, workspaceId))
      .orderBy(desc(t.digests.createdAt))
      .limit(limit);
  }

  async findById(workspaceId: string, id: string): Promise<DigestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digests)
      .where(and(eq(t.digests.workspaceId, workspaceId), eq(t.digests.id, id)))
      .limit(1);
    return row;
  }

  async markPublished(workspaceId: string, id: string, publishedAt: Date): Promise<void> {
    await this.db
      .update(t.digests)
      .set({ publishedAt })
      .where(and(eq(t.digests.workspaceId, workspaceId), eq(t.digests.id, id)));
  }
}
