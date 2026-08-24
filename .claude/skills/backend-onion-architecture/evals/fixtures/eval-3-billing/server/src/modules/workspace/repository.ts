import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { workspaces } from '../../db/schema/workspaces';

export class WorkspaceRepository {
  constructor(private readonly db: Db) {}

  async getPlan(workspaceId: string) {
    const [row] = await this.db
      .select({ plan: workspaces.plan })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.plan ?? 'free';
  }
}
