import type { Container } from '../../platform/container.js';
import type {
  ConventionCandidate,
  ConventionsPayload,
  ConventionSkillDraft,
  ConventionStatus,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ConventionsRepository } from './repository.js';
import { buildSkillDraft, toCandidate, toScan } from './helpers.js';
import { runExtraction, toInsertRows, type ExtractOpts } from './extract-pipeline.js';

/**
 * Conventions extractor — business logic.
 *
 * Note what this service does NOT do: create a skill. Accepting a convention only
 * marks its status; the merged skill is built as a draft, edited by the user, and
 * saved through the existing `POST /skills`. That keeps skill-writing in one place
 * and means this module never reaches into the skills slice — which
 * `no-cross-slice-import` forbids, and which is exactly what the reference build
 * got wrong.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionsPayload> {
    const [rows, scan] = await Promise.all([
      this.repo.listForRepo(workspaceId, repoId),
      this.repo.latestScan(workspaceId, repoId),
    ]);
    return {
      candidates: rows.map(toCandidate),
      last_scan: scan ? toScan(scan) : null,
    };
  }

  /**
   * Scan the clone and replace the pending candidates. One `convention_scans` row
   * is always written — including for a scan that found nothing, because "we
   * looked and found none" is different from "we never looked".
   */
  async extract(
    workspaceId: string,
    repoId: string,
    opts: ExtractOpts = {},
  ): Promise<ConventionsPayload> {
    const result = await runExtraction(this.container, this.repo, workspaceId, repoId, opts);

    const judged = await this.repo.judgedRules(workspaceId, repoId);
    const rows = toInsertRows(workspaceId, repoId, result.grounded, judged);
    const candidates = await this.repo.replacePending(workspaceId, repoId, rows);

    const scan = await this.repo.insertScan({
      workspaceId,
      repoId,
      filesSampled: result.files.length,
      candidates: rows.length,
      dropped: result.dropped,
      provider: result.provider,
      model: result.model,
    });

    return { candidates: candidates.map(toCandidate), last_scan: toScan(scan) };
  }

  /**
   * Edit the rule text. Only `rule` is writable — the evidence fields and
   * `confidence` are provenance proven against a file that was actually read, and
   * rewriting them would leave a line range and a confidence figure describing
   * nothing.
   */
  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.updateRule(workspaceId, id, rule.trim());
    if (!row) throw new NotFoundError('Convention not found');
    return toCandidate(row);
  }

  /** Accept, reject, or return to pending — one id or many. */
  async setStatus(
    workspaceId: string,
    ids: string[],
    status: ConventionStatus,
  ): Promise<ConventionCandidate[]> {
    const rows = await this.repo.setStatus(workspaceId, ids, status);
    if (rows.length === 0) throw new NotFoundError('No matching conventions');
    return rows.map(toCandidate);
  }

  /**
   * Build what the accepted conventions WOULD become. Persists nothing — the same
   * contract as `POST /skills/import`.
   */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    conventionIds: string[],
  ): Promise<ConventionSkillDraft> {
    const repoRow = await this.repo.findRepo(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const rows = (await this.repo.getManyById(workspaceId, conventionIds)).filter(
      (r) => r.repoId === repoId,
    );
    if (rows.length === 0) {
      throw new ValidationError('No conventions found for this repo');
    }
    return buildSkillDraft(repoRow.name, rows);
  }
}
