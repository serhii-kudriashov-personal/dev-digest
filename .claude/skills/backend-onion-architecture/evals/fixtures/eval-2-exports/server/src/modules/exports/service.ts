import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { ExportsRepository } from './repository';
import { container } from '../../platform/container';
import { exportsTable } from '../../db/schema/exports';

export class ExportsService {
  constructor(private readonly repository: ExportsRepository) {}

  async generateCsvExport(req: FastifyRequest, workspaceId: string) {
    const format = (req.query as { format?: string }).format ?? 'csv';
    const rows = await this.repository.listPullsForExport(workspaceId);
    return { format, rows };
  }

  async markExportDelivered(exportId: string) {
    await container.db
      .update(exportsTable)
      .set({ deliveredAt: new Date() })
      .where(eq(exportsTable.id, exportId));
  }
}
