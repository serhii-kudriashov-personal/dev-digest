import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GitInstanceInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { INSTANCE_REGISTER_RATE_LIMIT, INSTANCE_TEST_RATE_LIMIT } from './constants.js';
import { InstancesService } from './service.js';

/**
 * instances slice (SPEC-06) — HTTP + Zod only. All logic lives in `service.ts`,
 * all SQL in `repository.ts` (`backend-onion-architecture` §6).
 *
 *   POST   /instances          → GitInstance         (AC-1…AC-11)
 *   GET    /instances          → GitInstance[]       (AC-7, AC-8)
 *   POST   /instances/:id/test → InstanceTestResult  (AC-12)
 *   DELETE /instances/:id      → { deleted }
 *
 * Two things this file does deliberately, both `security` §A01:
 *
 *  - Every handler resolves `workspaceId` through `getContext` and hands it to
 *    the service; the `:id` in the URL is attacker-controlled and is scoped in
 *    the repository's `WHERE`, never by the route.
 *  - Validation is declared under `schema:`, so Fastify rejects a malformed
 *    body with 422 before the handler runs — a hand-rolled `.parse(req.body)`
 *    inside a handler is forbidden (`fastify-best-practices` rules/schemas).
 *
 * The two write paths reach an operator-named host, so both carry their own
 * rate limit, following `modules/ci/routes.ts`'s precedent (`security` §A06).
 */
export default async function instancesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new InstancesService(app.container);

  app.post(
    '/instances',
    {
      schema: { body: GitInstanceInput },
      config: { rateLimit: INSTANCE_REGISTER_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      const instance = await service.register(workspaceId, userId, req.body);
      reply.status(201);
      return instance;
    },
  );

  app.get('/instances', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post(
    '/instances/:id/test',
    {
      schema: { params: IdParams },
      config: { rateLimit: INSTANCE_TEST_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.test(workspaceId, req.params.id);
    },
  );

  app.delete('/instances/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });
}
