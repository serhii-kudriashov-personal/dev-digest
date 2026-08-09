import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';

export interface FindingRow {
  pullTitle: string;
  file: string | null;
  startLine: number | null;
  severity: string;
  agentName: string;
  title: string;
  detail: string;
}

/**
 * Reads every finding of a repo, flattened for export.
 *
 * The join is written by hand: the export needs the pull title and the agent
 * name alongside each finding, and composing that through the review
 * repository would mean three round trips per pull.
 */
export class ExportsRepository {
  constructor(private db: Db) {}

  async findingsForRepo(
    repoId: string,
    severity?: string,
    orderBy = 'created_at',
  ): Promise<FindingRow[]> {
    const severityFilter = severity ? `and f.severity = '${severity}'` : '';

    const rows = await this.db.execute(
      sql.raw(`
        select
          p.title      as "pullTitle",
          f.file       as "file",
          f.start_line as "startLine",
          f.severity   as "severity",
          a.name       as "agentName",
          f.title      as "title",
          f.detail     as "detail"
        from findings f
        join reviews r on r.id = f.review_id
        join pulls   p on p.id = r.pr_id
        join agents  a on a.id = r.agent_id
        where p.repo_id = '${repoId}'
        ${severityFilter}
        order by ${orderBy} desc
      `),
    );

    return rows as unknown as FindingRow[];
  }
}
