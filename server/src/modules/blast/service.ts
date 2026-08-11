import type { BlastRadiusResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  decideBlastState,
  foldBlastResult,
  isSourceFile,
  summarizeBlast,
  toChangedSymbols,
} from './helpers.js';

/**
 * Blast Radius slice — business logic.
 *
 * Three facts this class exists to keep true:
 *
 * 1. **It makes no LLM call and resolves no LLM port.** The whole answer is
 *    deterministic code over rows already in Postgres, so opening the card
 *    creates no `agent_runs` row and records no cost. A model call appearing here
 *    would be a change of feature, not an optimisation.
 * 2. **It reads through `container.reviewRepo` / `container.repoIntel` /
 *    `container.config`, never `container.db` and never a cross-slice import of
 *    `modules/reviews/**` or `modules/repo-intel/{service,repository}.ts`.** The
 *    container is the sanctioned channel between slices
 *    (`backend-onion-architecture` §4).
 * 3. **It never enters a code path that re-parses the clone or rebuilds the
 *    import graph.** That is what the index-state gate below is for — see the
 *    comment on step 9.
 *
 * Nothing is persisted or cached: the result is recomputed per request from
 * indexed reads. `pr_brief` is NOT written — it stays reserved for a later
 * lesson.
 */
export class BlastService {
  constructor(private container: Container) {}

  /**
   * Answer "what else could this diff touch?" for one PR.
   *
   * The `getPull` lookup is workspace-scoped and is the ownership check for the
   * whole endpoint — everything after it is keyed by `prId` / `repoId` alone, so
   * a missing or foreign PR must stop here rather than fall through to its data.
   */
  async build(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId, { requireOpen: false });
    if (!pull) throw new NotFoundError('Pull request not found');

    // `patch` is dropped: the response carries no diff text.
    const files = (await this.container.reviewRepo.getPrFiles(prId)).map((row) => row.path);
    const sourceFiles = files.filter(isSourceFile);

    // Reading `container.config` is ring-2 legal; reading `container.db` is not.
    const flagOn = this.container.config.repoIntelEnabled;

    const indexState = flagOn
      ? await this.container.repoIntel.getIndexState(pull.repoId)
      : null;

    // Probed ONLY for 'partial'. `status='full'` already implies the T3 block ran
    // (the pipeline only records `full` when the graph/rank step succeeded), so
    // the happy path does not pay for this read at all.
    const rankGraphPresent =
      indexState?.status === 'partial'
        ? (await this.container.repoIntel.getTopFilesByRank(pull.repoId, 1)).length > 0
        : true;

    const symbolRows = flagOn
      ? await this.container.repoIntel.getSymbolsInFiles(pull.repoId, sourceFiles)
      : [];

    const { state, reason } = decideBlastState({
      flagOn,
      indexStatus: indexState?.status ?? 'degraded',
      lastIndexedSha: indexState?.lastIndexedSha ?? '',
      rankGraphPresent,
      sourceFileCount: sourceFiles.length,
      indexedSymbolCount: symbolRows.length,
    });

    const changed_symbols = toChangedSymbols(symbolRows);

    // THE GATE, and the point of the feature.
    //
    // `getBlastRadius` has an expensive fallback: when the flag is off or the
    // index status is neither 'full' nor 'partial', `tryPersistentBlast` returns
    // `null` and the facade walks the entire git clone with ripgrep
    // (`codeIndex.symbols`), asks for references per symbol, and reads every
    // caller file off disk — at request time. Calling it in that state would
    // rebuild the AST during a GET.
    //
    // So the invariant is checked BEFORE the call, not inside it: with the flag
    // on and `status ∈ {full, partial}`, `tryPersistentBlast` cannot return
    // `null`, and the ripgrep/`readClone` path is therefore unreachable from
    // here by construction. `files_not_indexed` and an empty symbol set are
    // excluded too — there is nothing to compute, and asking would only spend a
    // round trip.
    const canQuery =
      state !== 'degraded' && reason !== 'files_not_indexed' && changed_symbols.length > 0;
    const downstream = canQuery
      ? foldBlastResult(await this.container.repoIntel.getBlastRadius(pull.repoId, files))
      : [];

    return {
      changed_symbols,
      downstream,
      summary: summarizeBlast(changed_symbols, downstream, state, reason),
      state,
      reason,
    };
  }
}
