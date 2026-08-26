import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { DigestsService } from './service.js';

/**
 * L07 — digests module.
 *   GET  /digests        → list the workspace's weekly digests (newest first)
 *   GET  /digests/:id    → one digest
 *   POST /digests/:id/publish → mark a digest published
 */

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export default async function digestRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get('/digests', { schema: { querystring: ListQuery } }, async (req) => {
    const { workspaceId } = getContext(req);
    const service = new DigestsService(req.server.container);
    return service.list(workspaceId, req.query.limit ?? 20);
  });

  api.get('/digests/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = getContext(req);
    const service = new DigestsService(req.server.container);
    const digest = await service.get(workspaceId, req.params.id);
    if (!digest) throw new NotFoundError('digest', req.params.id);
    return digest;
  });

  api.post('/digests/:id/publish', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = getContext(req);
    const service = new DigestsService(req.server.container);
    return service.publish(workspaceId, req.params.id);
  });
}
