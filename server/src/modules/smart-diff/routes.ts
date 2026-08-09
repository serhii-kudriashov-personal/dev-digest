import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff — HTTP edge. Zod only, no business logic, no SQL.
 *
 *   GET /pulls/:id/smart-diff  → the PR's files grouped and ordered by risk
 *
 * Validation is declared in `schema:` so Fastify rejects a non-uuid `:id` with
 * 422 before the handler runs — never a hand-rolled `Schema.parse(req.params)`.
 *
 * No `config.rateLimit` override, unlike `POST /pulls/:id/intent`: this endpoint
 * spends no money and makes no model call, so the app-wide limiter is enough.
 *
 * The only user input is `:id`. Its authorization is `getContext` →
 * `service.build(workspaceId, …)`, which looks the PR up scoped to the caller's
 * workspace and 404s otherwise — a lookup by `:id` alone would be an IDOR.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiffResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.build(workspaceId, req.params.id);
    },
  );
}
