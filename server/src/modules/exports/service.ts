import ExcelJS from 'exceljs';
import type { Container } from '../../platform/container.js';
import { ExportsRepository, type FindingRow } from './repository.js';
import { toCsv, toSheetRows } from './helpers.js';

export interface ExportRequest {
  repoId: string;
  format: string;
  severity?: string;
  orderBy?: string;
}

export interface ExportResult {
  body: string | Buffer;
  contentType: string;
  rowCount: number;
}

const SHEET_HEADER = ['Pull', 'File', 'Line', 'Severity', 'Agent', 'Title', 'Detail'];

/**
 * Builds a findings export for a repo. Everything the reviewers found, in one
 * file, so a lead can triage a week's worth of reviews in a spreadsheet.
 */
export class ExportsService {
  private repo: ExportsRepository;

  constructor(private container: Container) {
    this.repo = new ExportsRepository(container.db);
  }

  async build(req: ExportRequest): Promise<ExportResult> {
    const rows = await this.repo.findingsForRepo(req.repoId, req.severity, req.orderBy);

    this.recordExport(req.repoId, rows.length);

    if (req.format === 'xlsx') {
      return {
        body: await this.toWorkbook(rows),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        rowCount: rows.length,
      };
    }

    return { body: toCsv(rows), contentType: 'text/csv', rowCount: rows.length };
  }

  private async toWorkbook(rows: FindingRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Findings');
    sheet.addRow(SHEET_HEADER);
    for (const row of toSheetRows(rows)) sheet.addRow(row);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Fire-and-forget audit line so the export shows up in the activity feed. */
  private recordExport(repoId: string, rowCount: number) {
    try {
      this.container.reviewRepo.recordActivity({
        kind: 'findings_export',
        repoId,
        payload: { rowCount },
      });
    } catch {
      // An audit line is not worth failing a download over.
    }
  }
}
