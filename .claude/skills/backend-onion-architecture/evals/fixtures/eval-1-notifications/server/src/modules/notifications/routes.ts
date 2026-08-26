import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { notifications } from '../../db/schema/notifications';

const markReadParams = z.object({ notificationId: z.string().uuid() });

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/workspaces/:workspaceId/notifications', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    return app.container.notificationsService.listRecent(workspaceId);
  });

  app.post(
    '/workspaces/:workspaceId/notifications/:notificationId/read',
    { schema: { params: markReadParams } },
    async (req, reply) => {
      const { notificationId } = req.params as z.infer<typeof markReadParams>;
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, notificationId));
      reply.code(204).send();
    },
  );
};

export default notificationsRoutes;
