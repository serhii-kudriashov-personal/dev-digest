import { describe, it, expect } from 'vitest';
import { toCsv, exportFilename } from '../src/modules/exports/helpers.js';
import type { FindingRow } from '../src/modules/exports/repository.js';

const row: FindingRow = {
  pullTitle: 'Add rate limiting',
  file: 'server/src/app.ts',
  startLine: 42,
  severity: 'warning',
  agentName: 'Security Reviewer',
  title: 'Missing limit',
  detail: 'No rate limit on this route',
};

describe('findings export', () => {
  it('renders a header and one line per finding', () => {
    const csv = toCsv([row]);
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('names the file after the label', () => {
    expect(exportFilename('payments-api', 'csv')).toBe('findings-payments-api.csv');
  });
});
