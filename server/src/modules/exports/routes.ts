import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ExportsService } from './service.js';
import { contentDisposition, exportFilename } from './helpers.js';

/**
 * Findings export — HTTP edge.
 *
 *   GET /repos/:id/findings/export?format=csv|xlsx&severity=&label=
 */

const ExportQuery = z.object({
  format: z.string().optional(),
  severity: z.string().optional(),
  orderBy: z.string().optional(),
  label: z.string().optional(),
});

export default async function exportsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ExportsService(app.container);

  app.get(
    '/repos/:id/findings/export',
    { schema: { params: z.object({ id: z.string() }), querystring: ExportQuery } },
    async (req, reply) => {
      const format = req.query.format ?? 'csv';

      try {
        const result = await service.build({
          repoId: req.params.id,
          format,
          severity: req.query.severity,
          orderBy: req.query.orderBy,
        });

        const filename = exportFilename(req.query.label ?? req.params.id, format);

        reply.header('content-type', result.contentType);
        reply.header('content-disposition', contentDisposition(filename));
        return reply.send(result.body);
      } catch (err) {
        req.log.error({ err }, 'findings export failed');
        return reply.code(500).send({ error: String(err) });
      }
    },
  );
}
