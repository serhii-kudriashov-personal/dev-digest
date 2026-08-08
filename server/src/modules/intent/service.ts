import type { Container } from '../../platform/container.js';
import type { PrIntentRecord } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentRepository, type StoredIntent } from './repository.js';
import { classifyIntent, collectSources } from './pipeline.js';
import { MAX_COMMITS } from './constants.js';
import {
  deterministicConfidence,
  isSubstantiveBody,
  linkedSpecPaths,
  renderIntentBlock,
  validateClassification,
} from './helpers.js';
import type { DerivedIntent, IntentFacade, IntentSink } from './types.js';

/**
 * Intent slice — business logic.
 *
 * Implements the `IntentFacade` degraded contract: `ensure` NEVER throws. Intent
 * is enrichment, and a review must always be able to run without it, so every
 * failure path returns `null` and logs rather than propagating.
 *
 * `get` does NOT share that guarantee, deliberately. It throws `NotFoundError`
 * when the PR itself does not exist in this workspace, because that is a bad
 * request rather than missing enrichment — the HTTP edge needs the 404. A
 * derived intent that simply has not been computed yet is `null`, not a throw.
 * Any future cross-slice caller of `get` must handle that; only `ensure` is safe
 * to call unguarded.
 *
 * Reads `container.<port>` but NEVER `container.db` — the repository is
 * constructed with it once, here, which is the sanctioned line.
 */
export class IntentService implements IntentFacade {
  private repo: IntentRepository;

  constructor(private container: Container) {
    this.repo = new IntentRepository(container.db);
  }

  async get(workspaceId: string, prId: string): Promise<DerivedIntent | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const row = await this.repo.getIntent(prId);
    if (!row) return null;
    return this.toDerived(row, pull.headSha);
  }

  async ensure(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean; sink?: IntentSink } = {},
  ): Promise<DerivedIntent | null> {
    const sink = opts.sink;
    try {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) return null;

      const existing = await this.repo.getIntent(prId);
      // The cached row is authoritative while the PR has not moved. This is the
      // assertion the "no second LLM call" test pins.
      if (existing && !opts.force && existing.head_sha === pull.headSha) {
        return this.toDerived(existing, pull.headSha);
      }

      const repo = await this.repo.getRepo(workspaceId, pull.repoId);
      if (!repo) return null;

      const [files, commits] = await Promise.all([
        this.repo.getPrFiles(prId),
        this.repo.getPrCommits(prId, MAX_COMMITS),
      ]);
      // The secondary route to a linked plan: chunks already indexed as
      // `source = 'spec'`, looked up by the SAME allowlisted paths the primary
      // `git.readFile` route uses. May legitimately be empty forever — nothing
      // in this lesson guarantees a writer for that source value.
      const specChunks = await this.repo
        .getSpecChunks(workspaceId, pull.repoId, linkedSpecPaths(pull.body))
        .catch(() => []);

      const sources = await collectSources(
        this.container,
        repo,
        pull,
        files,
        commits,
        specChunks,
      );

      const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
      const outcome = await classifyIntent(this.container, repo, pull, sources, choice);

      // The model's claim about which sources it used is VALIDATED against what
      // was actually presented, and the rejects are reported rather than
      // swallowed — a model that mis-attributes systematically must not look
      // like one that never attributes.
      const { sources: usedSources, rejected } = validateClassification(
        outcome.data.evidence_used,
        sources.labels,
      );
      const confidence = deterministicConfidence(usedSources, {
        substantiveBody: isSubstantiveBody(pull.body),
      });

      const generatedAt = new Date();
      await this.repo.upsertIntent({
        prId,
        intent: outcome.data.intent,
        inScope: outcome.data.in_scope,
        outOfScope: outcome.data.out_of_scope,
        headSha: pull.headSha,
        confidence,
        modelConfidence: outcome.data.confidence,
        sources: usedSources,
        provider: outcome.provider,
        model: outcome.model,
        generatedAt,
      });

      if (sink) {
        sink.info(`Intent sources: ${usedSources.join(', ') || 'none'}`);
        sink.info(`Intent confidence: ${confidence} (deterministic)`);
        sink.info(`Intent model: ${outcome.provider}/${outcome.model}`);
        sink.info(
          `Intent tokens: in=${outcome.tokensIn} out=${outcome.tokensOut} cost=${
            // Unknown cost is null, never 0 — a run that could not be attributed
            // must not read as a free one.
            outcome.costUsd == null ? 'unknown' : `$${outcome.costUsd.toFixed(6)}`
          }`,
        );
        if (rejected.length > 0) {
          sink.info(`Intent discarded unpresented source labels: ${rejected.join(', ')}`);
        }
      }

      const row = await this.repo.getIntent(prId);
      return row ? this.toDerived(row, pull.headSha) : null;
    } catch (e) {
      // The degraded contract, honoured: never throw at a caller. Log what
      // happened so a silent absence is still explicable.
      sink?.info(`Intent derivation skipped: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Add the read-time judgement the repository cannot make.
   *
   * `stale` compares the stored `head_sha` against the pull's CURRENT head, so
   * it is a property of this read rather than of the row — which is why the
   * repository returns `StoredIntent` (the DTO minus `stale`) and the mapping
   * from the Drizzle row lives there, not here.
   */
  private toDerived(stored: StoredIntent, currentHeadSha: string): DerivedIntent {
    const stale = stored.head_sha != null && stored.head_sha !== currentHeadSha;
    const record: PrIntentRecord = { ...stored, stale };
    return { record, promptBlock: renderIntentBlock(record), stale };
  }
}
