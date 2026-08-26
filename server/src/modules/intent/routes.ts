import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { IntentService } from './service.js';

/**
 * Derived PR intent — HTTP edge. Zod only, no business logic, no SQL.
 *
 *   GET  /pulls/:id/intent  → the stored intent (404 when never derived)
 *   POST /pulls/:id/intent  → derive it; `{ force: true }` re-derives
 *
 * Validation is declared in `schema:` so Fastify rejects bad input with 422
 * before the handler runs — never a hand-rolled `Schema.parse(req.body)`.
 */

// Both fields optional and an empty body is valid, so the object carries a
// default rather than the handler tolerating `undefined`.
const DeriveBody = z.object({ force: z.boolean().optional() }).default({});

export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const derived = await service.get(workspaceId, req.params.id);
    if (!derived) throw new NotFoundError('No intent derived for this pull request yet');
    return derived.record;
  });

  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, body: DeriveBody },
      // Tighter than the review route's 10/min: this endpoint spends money on
      // every call, and `force` deliberately bypasses the cache.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const derived = await service.ensure(workspaceId, req.params.id, {
        ...(req.body.force !== undefined ? { force: req.body.force } : {}),
      });
      // `ensure` returns null on ANY failure by contract, so the edge is the
      // place that turns "could not derive" into a status code.
      if (!derived) throw new NotFoundError('Could not derive intent for this pull request');
      return derived.record;
    },
  );
}
