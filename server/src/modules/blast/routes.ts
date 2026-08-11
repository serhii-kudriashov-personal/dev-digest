import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast Radius — HTTP edge. Zod only, no business logic, no SQL.
 *
 *   GET /pulls/:id/blast  → which symbols the PR changes, who calls them, and
 *                           which endpoints/crons those callers serve
 *
 * Validation is declared in `schema:` so Fastify rejects a non-uuid `:id` with
 * 422 before the handler runs — never a hand-rolled `Schema.parse(req.params)`.
 *
 * No `config.rateLimit` override: this endpoint spends no money, makes no model
 * call and parses no code, so the app-wide limiter is enough (same reasoning as
 * `smart-diff/routes.ts`).
 *
 * The only user input is `:id`. Its authorization is `getContext` →
 * `service.build(workspaceId, …)`, which looks the PR up scoped to the caller's
 * workspace and 404s otherwise — a lookup by `:id` alone would be an IDOR.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.build(workspaceId, req.params.id);
    },
  );
}
