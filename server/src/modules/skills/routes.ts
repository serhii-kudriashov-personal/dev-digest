import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { IMPORT_BODY_LIMIT_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module (owner A1).
 *   GET    /skills              → list (workspace-scoped)
 *   GET    /skills/:id          → one skill
 *   POST   /skills              → create
 *   PUT    /skills/:id          → update (a BODY change appends a version)
 *   DELETE /skills/:id          → delete (agent links cascade)
 *   GET    /skills/:id/versions → body history (newest first)
 *   GET    /skills/:id/used-by  → agents currently linking this skill
 *   GET    /skills/:id/stats    → usage + outcome stats
 *   POST   /skills/:id/restore  → { version } → APPENDS that body as a new version
 *   POST   /skills/import       → parse an upload into a preview; persists NOTHING
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  /** Paths this skill was extracted from — set by the conventions extractor. */
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  /** Recorded against the new version; ignored unless `body` actually changed. */
  version_message: z.string().optional(),
});

/** `POST /skills/:id/restore` — which version's body to bring back. */
const RestoreBody = z.object({ version: z.number().int().positive() });

const ImportBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  /**
   * Registered BEFORE `/skills/:id` on purpose: `IdParams` requires a uuid, so
   * with the reverse order the literal path "import" is validated as `:id` and
   * rejected with a 422 before this handler is ever considered.
   *
   * `bodyLimit` is raised for this route alone. The app-wide default is 1 MiB
   * (`app.ts`) and the payload is base64 (~33% larger than the file), so without
   * this a modest upload fails with Fastify's opaque 413 instead of the clear
   * size error the service raises.
   */
  app.post(
    '/skills/import',
    { schema: { body: ImportBody }, bodyLimit: IMPORT_BODY_LIMIT_BYTES },
    async (req) => {
      await getContext(app.container, req);
      return service.importPreview(req.body.filename, req.body.content_base64);
    },
  );

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      body: body.body,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.evidence_files !== undefined ? { evidenceFiles: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { version_message, ...patch } = req.body;
      const skill = await service.update(workspaceId, req.params.id, {
        ...patch,
        ...(version_message !== undefined ? { versionMessage: version_message } : {}),
      });
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/used-by', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.usedBy(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  // Appends a new version carrying the old body — never rewinds. A 404 covers
  // both "no such skill" and "no such version": from the caller's side there is
  // nothing to restore either way.
  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(workspaceId, req.params.id, req.body.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );
}
