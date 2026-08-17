import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BRIEF_RATE_LIMIT } from './constants.js';
import { BriefService } from './service.js';

/**
 * PR Risk Brief — HTTP edge. Zod only, no business logic, no SQL.
 *
 *   GET  /pulls/:id/brief  → the stored brief (404 when never generated)
 *   POST /pulls/:id/brief  → generate it; `{ force: true }` re-generates
 *
 * Validation is declared in `schema:` so Fastify rejects bad input with 422
 * before the handler runs — never a hand-rolled `Schema.parse(req.body)`.
 *
 * The only user input is `:id` and `force`. Authorization is `getContext` →
 * `service.get`/`service.generate`, which look the PR up scoped to the
 * caller's workspace and 404 otherwise — a lookup by `:id` alone would be an
 * IDOR (AC-6).
 */

// Both fields optional and an empty body is valid, so the object carries a
// default rather than the handler tolerating `undefined` — same shape as
// `intent/routes.ts`.
const GenerateBody = z.object({ force: z.boolean().optional() }).default({});

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  // No rate-limit override: the read spends nothing.
  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const brief = await service.get(workspaceId, req.params.id);
    if (!brief) throw new NotFoundError('No brief generated for this pull request yet');
    return brief;
  });

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: GenerateBody },
      // NFR-4, `security` §A06 "AI generation — 3 req / 1 min". Keyed on the
      // PR id (not the caller) so one PR's regenerate-mashing cannot exhaust
      // a shared bucket that a different PR's legitimate request also uses.
      config: {
        rateLimit: {
          ...BRIEF_RATE_LIMIT,
          keyGenerator: (req: FastifyRequest) => `brief:${(req.params as { id: string }).id}`,
        },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // `generate` answers every non-404 outcome as a 200 body
      // (`too_large` / `failed` / `not_configured` are states the card
      // renders, never HTTP errors) — only a foreign/missing PR 404s.
      return service.generate(workspaceId, req.params.id, {
        ...(req.body.force !== undefined ? { force: req.body.force } : {}),
      });
    },
  );
}
