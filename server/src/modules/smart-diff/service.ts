import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  buildSmartDiff,
  type SmartDiffFileInput,
  type SmartDiffFindingInput,
} from './helpers.js';

/**
 * Smart Diff slice — business logic.
 *
 * Two facts this class exists to keep true:
 *
 * 1. **It makes no LLM call and resolves no LLM port.** The ordering is
 *    deterministic code over rows already in Postgres, so rendering a smart
 *    diff creates no `agent_runs` row and records no cost. A model call
 *    appearing here would be a change of feature, not an optimisation.
 * 2. **It reads through `container.reviewRepo`, never `container.db` and never
 *    a cross-slice import of `modules/reviews/**`.** The container is the
 *    sanctioned channel between slices (`backend-onion-architecture` §4), and
 *    it is the only shape `no-cross-slice-import` permits.
 *
 * Nothing is persisted or cached: the result is recomputed per request from two
 * indexed reads.
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  /**
   * Group and order a PR's changed files by risk.
   *
   * The `getPull` lookup is workspace-scoped and is the ownership check for the
   * whole endpoint — everything after it is keyed by `prId` alone, so a missing
   * or foreign PR must stop here rather than fall through to its data.
   */
  async build(workspaceId: string, prId: string): Promise<SmartDiff> {
    const repo = this.container.reviewRepo;

    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // `patch` is dropped here on purpose: the response carries paths, counts and
    // line numbers only. The client already holds the diff bodies from
    // `GET /pulls/:id`, and re-sending them would double the payload for nothing.
    const rows = await repo.getPrFiles(prId);
    const files: SmartDiffFileInput[] = rows.map((row) => ({
      path: row.path,
      additions: row.additions,
      deletions: row.deletions,
    }));

    // EVERY review of the PR, not just the newest. One "Run Review" click
    // produces one `reviews` row per agent, so "the latest review" would show a
    // single agent's findings; the PR-list severity rollup already unions them
    // the same way.
    const reviews = await repo.reviewsForPull(prId);
    const findings: SmartDiffFindingInput[] = reviews.flatMap((entry) =>
      entry.findings.map((finding) => ({ file: finding.file, start_line: finding.startLine })),
    );

    return buildSmartDiff(files, findings);
  }
}
