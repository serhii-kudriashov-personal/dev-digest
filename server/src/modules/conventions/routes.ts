import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus, Provider } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * Conventions extractor — HTTP edge. Zod only, no business logic.
 *
 *   GET   /repos/:id/conventions              → candidates + latest scan
 *   POST  /repos/:id/conventions/extract      → scan (sync, ONE model call)
 *   PATCH /conventions/:id                    → edit the rule text
 *   PATCH /repos/:id/conventions/status       → accept / reject / deselect, bulk
 *   POST  /repos/:id/conventions/skill-draft  → merged draft; persists NOTHING
 *
 * One bulk status route rather than three verbs: single-card Accept, single-card
 * Reject and the header's "Deselect all" differ only in a literal, and three
 * routes would be three things to keep in step.
 */

const ExtractBody = z
  .object({
    provider: Provider.optional(),
    model: z.string().min(1).optional(),
  })
  .default({});

const UpdateRuleBody = z.object({ rule: z.string().min(1) });

const SetStatusBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: ConventionStatus,
});

const SkillDraftBody = z.object({
  convention_ids: z.array(z.string().uuid()).min(1),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams, body: ExtractBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { provider, model } = req.body;
      return service.extract(workspaceId, req.params.id, {
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      });
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateRuleBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateRule(workspaceId, req.params.id, req.body.rule);
    },
  );

  app.patch(
    '/repos/:id/conventions/status',
    { schema: { params: IdParams, body: SetStatusBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setStatus(workspaceId, req.body.ids, req.body.status);
    },
  );

  app.post(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams, body: SkillDraftBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id, req.body.convention_ids);
    },
  );
}
