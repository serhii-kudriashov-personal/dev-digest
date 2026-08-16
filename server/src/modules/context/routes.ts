import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextDocsUpdate, ContextRootsUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * Project Context (SPEC-01) — HTTP edge. Zod only, no business logic, no SQL.
 *
 *   GET    /repos/:id/context             → the document listing (ALWAYS 200)
 *   POST   /repos/:id/context/refresh     → re-scan, same shape
 *   GET    /repos/:id/context/doc?path=…  → one document's text (read-only)
 *   PUT    /repos/:id/context/roots       → the per-repository search roots
 *   GET|PUT /agents/:id/context-docs      → an agent's ordered attachments
 *   GET|PUT /skills/:id/context-docs      → a skill's ordered attachments
 *
 * Two things every handler does, in this order, before anything else:
 * `getContext(container, req)` for tenancy — being on `/repos/:id/` is not
 * proof of access to that repository — and then a single call into
 * `container.projectContext`. Errors are THROWN (`NotFoundError`,
 * and `ValidationError` from the service), never hand-crafted with
 * `reply.code(...).send(...)`, which would bypass the
 * `{ error: { code, message, details } }` envelope and the logging.
 *
 * The listing endpoint answers 200 for every state INCLUDING "not synced". A
 * 404 there would be cached for the session by a `retry: false` client query
 * (`client/INSIGHTS.md` 2026-08-09) and the tab would never recover when the
 * mirror arrives — and "no mirror yet" is a state, not an error.
 */

/**
 * One search-root glob. Tightened at the edge beyond the shared contract's
 * length bounds: control characters and NUL have no place in a path pattern and
 * are rejected by the route schema, so a malformed root is a 422 before the
 * handler runs rather than something the matcher has to survive.
 */
const RootPattern = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[^\x00-\x1f\x7f]+$/, 'A search root may not contain control characters');

const RootsBody = ContextRootsUpdate.extend({
  roots: z.array(RootPattern).min(1).max(20),
});

/** `path` is attacker-controlled; the service re-validates it against the allowlist. */
const DocQuery = z.object({ path: z.string().min(1).max(300) });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.list(workspaceId, req.params.id);
  });

  // A re-scan, not a re-index: there is no Markdown index to rebuild. It also
  // re-evaluates every attachment's `missing` marker (AC-9).
  app.post('/repos/:id/context/refresh', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.list(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await app.container.projectContext.read(
        workspaceId,
        req.params.id,
        req.query.path,
      );
      if (!doc) throw new NotFoundError('Document not found in this repository');
      return doc;
    },
  );

  app.put(
    '/repos/:id/context/roots',
    { schema: { params: IdParams, body: RootsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const roots = await app.container.projectContext.setRoots(
        workspaceId,
        req.params.id,
        req.body.roots,
      );
      if (!roots) throw new NotFoundError('Repository not found');
      return { roots };
    },
  );

  app.get('/agents/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const docs = await app.container.projectContext.agentDocs(workspaceId, req.params.id);
    if (!docs) throw new NotFoundError('Agent not found');
    return docs;
  });

  // Whole-list replace, carrying the full ordered path list — the same shape the
  // skills tab uses, so one optimistic client mutation serves both. The service's
  // over-limit `ValidationError` surfaces here as a 422 naming the limit (AC-26).
  app.put(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: ContextDocsUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const docs = await app.container.projectContext.replaceAgentDocs(
        workspaceId,
        req.params.id,
        req.body.paths,
      );
      if (!docs) throw new NotFoundError('Agent not found');
      return docs;
    },
  );

  app.get('/skills/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const docs = await app.container.projectContext.skillDocs(workspaceId, req.params.id);
    if (!docs) throw new NotFoundError('Skill not found');
    return docs;
  });

  app.put(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: ContextDocsUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const docs = await app.container.projectContext.replaceSkillDocs(
        workspaceId,
        req.params.id,
        req.body.paths,
      );
      if (!docs) throw new NotFoundError('Skill not found');
      return docs;
    },
  );
}
