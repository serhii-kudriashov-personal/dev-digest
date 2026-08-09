import type { FindingRow } from './repository.js';

/**
 * Pure formatting for the findings export — the CSV text and the XLSX row
 * shape. No I/O, no container.
 */

const CSV_COLUMNS = ['pull', 'file', 'line', 'severity', 'agent', 'title', 'detail'];

/** One CSV cell. Commas and newlines are wrapped in quotes. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.includes(',') || text.includes('\n')) return `"${text}"`;
  return text;
}

export function toCsv(rows: FindingRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const body = rows.map((row) =>
    [
      cell(row.pullTitle),
      cell(row.file),
      cell(row.startLine),
      cell(row.severity),
      cell(row.agentName),
      cell(row.title),
      cell(row.detail),
    ].join(','),
  );
  return [header, ...body].join('\n');
}

export function toSheetRows(rows: FindingRow[]): unknown[][] {
  return rows.map((row) => [
    row.pullTitle,
    row.file,
    row.startLine,
    row.severity,
    row.agentName,
    row.title,
    row.detail,
  ]);
}

/**
 * The name the browser saves the download as. Callers pass a label so a
 * per-repo export is recognisable on disk.
 */
export function exportFilename(label: string, format: string): string {
  return `findings-${label}.${format}`;
}

/** The `Content-Disposition` header value for the download. */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}
