import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db';
import { notifications } from '../../db/schema/notifications';

export class NotificationsRepository {
  constructor(private readonly db: Db) {}

  findRecent(workspaceId: string, limit = 20) {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, workspaceId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markRead(workspaceId: string, notificationId: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, notificationId));
  }
}
