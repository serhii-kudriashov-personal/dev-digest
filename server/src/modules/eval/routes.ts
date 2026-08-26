import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalRunSetInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';

/**
 * eval slice (L06, SPEC-04) — HTTP + Zod only. All logic lives in
 * `service.ts`; all SQL lives in `repository.ts` (`backend-onion-architecture`
 * §6). Every handler resolves `workspaceId` and scopes on it — a case, run or
 * agent id in the URL is attacker-controlled (`security` A01).
 *
 *   POST   /findings/:id/eval-case          → freeze a judged finding (AC-1…AC-9)
 *   GET    /agents/:id/eval-cases           → an agent's case set
 *   POST   /agents/:id/eval-cases           → hand-author a case
 *   GET    /eval-cases/:id                  → one case
 *   PUT    /eval-cases/:id                  → edit a case (AC-12…AC-14)
 *   DELETE /eval-cases/:id                  → delete a case (AC-16)
 *   POST   /eval-cases/:id/run              → run one case (AC-32)
 *   POST   /agents/:id/eval-runs            → run the agent's set (AC-17…AC-31)
 *   GET    /agents/:id/eval-runs            → run history for an agent
 *   GET    /agents/:id/eval-trend           → an agent's own metric trend (AC-47)
 *   GET    /eval-runs/:id                   → one set run (AC-28 polling)
 *   GET    /eval-runs/:id/cases             → per-case detail for a set run
 *   POST   /eval-runs/:id/cancel            → cancel an in-flight run (AC-29)
 *   GET    /eval-dashboard                  → cross-agent dashboard (AC-40…AC-44)
 *   GET    /eval-comparison?a=&b=           → two-run comparison (AC-33…AC-37)
 *   POST   /eval-runs                       → run every enabled agent's set (A12)
 */

const EvalCaseUpdateInput = EvalCaseInput.partial();

/** Both ids required — AC-34 refuses anything but exactly two. */
const EvalComparisonQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

// Each run route fans out to N paid model calls — its own tight limit
// (`reviews/routes.ts` is the precedent; `security` A06).
const RUN_RATE_LIMIT = { max: 5, timeWindow: '1 minute' } as const;

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ---- case creation --------------------------------------------------------

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.createCaseFromFinding(workspaceId, req.params.id);
      reply.code(201);
      return result;
    },
  );

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // owner_kind/owner_id are forced from the URL, never trusted from the
      // body — a caller could otherwise create a case under another agent.
      return service.createCase(workspaceId, {
        ...req.body,
        owner_kind: 'agent',
        owner_id: req.params.id,
      });
    },
  );

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getCase(workspaceId, req.params.id);
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseUpdateInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    return { ok };
  });

  // ---- running ----------------------------------------------------------

  app.post('/eval-cases/:id/run', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.runCase(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, body: EvalRunSetInput },
      config: { rateLimit: RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runSet(workspaceId, req.params.id, req.body.case_ids, req.log);
    },
  );

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-trend', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.trend(workspaceId, req.params.id);
  });

  app.get('/eval-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getRun(workspaceId, req.params.id);
  });

  app.get('/eval-runs/:id/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRunCases(workspaceId, req.params.id);
  });

  app.post('/eval-runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.cancelRun(workspaceId, req.params.id);
    return { ok: true };
  });

  app.post(
    '/eval-runs',
    { config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllAgents(workspaceId, req.log);
    },
  );

  // ---- dashboard + comparison ---------------------------------------------

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId);
  });

  app.get(
    '/eval-comparison',
    { schema: { querystring: EvalComparisonQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, [req.query.a, req.query.b]);
    },
  );
}
