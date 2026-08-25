import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MultiAgentStartRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MULTI_AGENT_RATE_LIMIT } from './constants.js';
import { MultiAgentService } from './service.js';

/**
 * Multi-agent review — HTTP edge (SPEC-05). Zod only, no business logic, no SQL.
 *
 *   POST /pulls/:id/multi-agent-runs   {agent_ids}  → start a run; returns the record
 *   GET  /pulls/:id/multi-agent-runs                → run history for a PR, newest first
 *   GET  /multi-agent-runs/:id                      → one run's full results
 *   GET  /multi-agent/agent-history                 → every agent's last completed run
 *
 * Validation is declared in `schema:` so Fastify rejects bad input with 422
 * before the handler runs — never a hand-rolled `Schema.parse(req.body)`.
 *
 * Every handler resolves `workspaceId` via `getContext` first and scopes its
 * query by it (AC-20) — `GET /multi-agent-runs/:id` is a direct-object read,
 * and a missing workspace predicate there would be a cross-tenant disclosure.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MultiAgentService(app.container);

  // ---- Start a multi-agent run ---------------------------------------------
  // Tight per-route limit: each call can fan out to up to MAX_AGENTS_PER_RUN
  // paid model calls (same reasoning as `reviews/routes.ts`'s `/pulls/:id/review`).
  app.post(
    '/pulls/:id/multi-agent-runs',
    {
      schema: { params: IdParams, body: MultiAgentStartRequest },
      config: { rateLimit: MULTI_AGENT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { agent_ids } = req.body;
      return service.start(workspaceId, req.params.id, agent_ids, req.log);
    },
  );

  // ---- Run history for a PR ------------------------------------------------
  app.get('/pulls/:id/multi-agent-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForPull(workspaceId, req.params.id);
  });

  // ---- One run's full results (lanes, grouped locations, totals) ----------
  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.results(workspaceId, req.params.id);
  });

  // ---- Per-agent history (Configure-run screen's pre-run estimate) --------
  app.get('/multi-agent/agent-history', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.agentHistory(workspaceId);
  });
}
