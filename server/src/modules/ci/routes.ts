import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * ci slice (SPEC-05) — HTTP + Zod only. All logic lives in `service.ts`; all
 * SQL lives in `repository.ts` (`backend-onion-architecture` §6). Every
 * handler resolves `workspaceId` and scopes on it — the `agentId` in the URL
 * is attacker-controlled (`security` §A01).
 *
 *   POST /agents/:id/export-ci        → CiExport            (AC-1…AC-24)
 *   POST /ci/refresh                  → { ingested: number } (AC-25)
 *   GET  /ci-runs                     → CiRun[]              (AC-28…AC-32)
 *   GET  /agents/:id/ci-installations → CiInstallation[]     (AC-22, AC-33)
 */

// The write path commits to a real repository and may open a pull request —
// its own tight limit, following `modules/eval/routes.ts`'s precedent
// (`security` §A06).
const EXPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
// Refresh fans out to N GitHub calls (one `listWorkflowRuns` plus up to N
// `downloadRunArtifact` per installation) — its own modest limit, distinct
// from the export path (`security` §A06).
const REFRESH_RATE_LIMIT = { max: 5, timeWindow: '1 minute' } as const;

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CiService(container);

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput },
      config: { rateLimit: EXPORT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { id: agentId } = req.params;
      if (req.body.action === 'files') {
        return service.preview(workspaceId, agentId, req.body);
      }
      return service.install(workspaceId, agentId, req.body);
    },
  );

  app.post('/ci/refresh', { config: { rateLimit: REFRESH_RATE_LIMIT } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.refresh(workspaceId, req.log);
  });

  app.get('/ci-runs', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId);
  });

  app.get('/agents/:id/ci-installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });
}
