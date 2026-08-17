import type { Container } from '../../platform/container.js';
import type { BriefGenerationResult, PrRiskBriefRecord, StoredRiskBrief } from '@devdigest/shared';
import type { PullRow } from '../../db/rows.js';
import { ConfigError, NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BriefRepository } from './repository.js';
import { collectBlocks, fitBudget, requestBrief } from './pipeline.js';
import {
  capBrief,
  isTitleRestatement,
  redactSecrets,
  validateFocus,
  validateRisks,
} from './helpers.js';

/**
 * Single-flight de-duplication (AC-4, NFR-7). Module-level, deliberately — a
 * `BriefService` instance is created PER REQUEST (`new BriefService(app.container)`
 * in `routes.ts`, same as every other slice's service), so an instance field
 * would not survive across concurrent requests. Keyed by `prId`; a different
 * PR is unconstrained. R3 in the plan: this collapses concurrency within ONE
 * Node process only — acceptable, DevDigest is local-first single-process.
 */
const inFlight = new Map<string, Promise<BriefGenerationResult>>();

/**
 * PR Risk Brief slice — business logic.
 *
 * Reads `container.<port>` but NEVER `container.db` — the repository is
 * constructed with it once, here, which is the sanctioned line
 * (`backend-onion-architecture` §4).
 */
export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /** The stored brief for a PR, with `stale` attached at read time, or `null`
   *  when none has been generated yet. */
  async get(workspaceId: string, prId: string): Promise<PrRiskBriefRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getBrief(prId);
    if (!stored) return null;
    const stale = await this.isStale(stored, pull);
    return { ...stored, pr_id: prId, stale };
  }

  async generate(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean } = {},
  ): Promise<BriefGenerationResult> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    if (!opts.force) {
      const stored = await this.repo.getBrief(prId);
      if (stored) {
        const stale = await this.isStale(stored, pull);
        // Matches the current head AND no completed review has superseded it
        // — the cached path spends nothing (AC-2, NFR-5).
        if (!stale) return { state: 'ok', brief: { ...stored, pr_id: prId, stale: false } };
      }
    }

    const existing = inFlight.get(prId);
    if (existing) return existing;

    const run = this.doGenerate(workspaceId, prId, pull);
    inFlight.set(prId, run);
    try {
      return await run;
    } finally {
      inFlight.delete(prId);
    }
  }

  /**
   * AC-34/AC-35: stale from TWO independent facts, computed at READ time and
   * NEVER stored — a new head commit, or a review that completed after this
   * document was generated.
   */
  private async isStale(stored: StoredRiskBrief, pull: PullRow): Promise<boolean> {
    if (stored.head_sha !== pull.headSha) return true;
    const reviews = await this.container.reviewRepo.reviewsForPull(pull.id);
    const latest = reviews[0]?.review.createdAt;
    if (!latest) return false;
    return new Date(latest).getTime() > new Date(stored.generated_at).getTime();
  }

  private async doGenerate(
    workspaceId: string,
    prId: string,
    pull: PullRow,
  ): Promise<BriefGenerationResult> {
    const [repo, files, reviews] = await Promise.all([
      this.repo.getRepo(pull.repoId),
      this.repo.getPrFiles(prId),
      this.container.reviewRepo.reviewsForPull(prId),
    ]);
    // Referential-integrity anomaly, not a normal degraded path — `repoId` is
    // a NOT NULL cascading FK, so this should not happen in practice.
    if (!repo) throw new NotFoundError('Pull request repository not found');

    // "The pull request's findings" — the MOST RECENT completed review's
    // findings, since a later review supersedes the brief entirely (AC-35)
    // rather than accumulating every past review's findings.
    const findings = reviews[0]?.findings ?? [];

    const collected = await collectBlocks(
      this.container,
      workspaceId,
      prId,
      repo,
      pull,
      files,
      findings,
    );

    const choice = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    try {
      // Resolved here — before the budget-fit work — purely to short-circuit
      // on a missing key. `container.llm` caches by provider id, so
      // `requestBrief`'s own resolution below is a cheap cache hit, not a
      // second secrets read.
      await this.container.llm(choice.provider);
    } catch (e) {
      // A normal path, never a 500 (`backend-onion-architecture` §4, AC-39).
      if (e instanceof ConfigError) return { state: 'not_configured' };
      throw e;
    }

    const fit = fitBudget(collected.blocks, repo, pull, this.container.tokenizer);
    if (!fit.ok) {
      // AC-15: identity alone overflows — no model call is made.
      return { state: 'too_large', identity_tokens: fit.identityTokens, budget: fit.budget };
    }

    let outcome;
    try {
      outcome = await requestBrief(this.container, repo, pull, fit.blocks, choice);
    } catch {
      // AC-38: the previous document is left untouched — nothing is written below.
      return { state: 'failed', reason: 'provider_error' };
    }

    // AC-17…AC-20: nothing the model claims about a file, a line or an
    // endpoint is trusted until it is checked against the PR's own data.
    const { kept: risks, dropped: droppedRisks } = validateRisks(
      outcome.data.risks,
      collected.changedPaths,
      collected.knownEndpoints,
    );
    const { kept: reviewFocus, dropped: droppedFocus } = validateFocus(
      outcome.data.review_focus,
      collected.rangesByPath,
    );

    // AC-22/AC-23: a title restatement or a missing what/why is unusable —
    // nothing is stored.
    if (
      !outcome.data.what.trim() ||
      !outcome.data.why.trim() ||
      isTitleRestatement(outcome.data.what, pull.title)
    ) {
      return { state: 'failed', reason: 'unusable_answer' };
    }

    // AC-42/NFR-3: cap AFTER validation, so a dropped entry never displaces a
    // kept one from the five-item cap.
    const capped = capBrief({ ...outcome.data, risks, review_focus: reviewFocus });

    // AC-24: redact BEFORE persist, display or log — every string field, one
    // seam for all three obligations.
    const doc: StoredRiskBrief = {
      what: redactSecrets(capped.what),
      why: redactSecrets(capped.why),
      risk_level: capped.risk_level,
      risks: capped.risks.map((r) => ({
        ...r,
        title: redactSecrets(r.title),
        explanation: redactSecrets(r.explanation),
      })),
      // AC-21: an explicit empty list survives as-is, never coerced to "missing".
      review_focus: capped.review_focus.map((f) => ({ ...f, reason: redactSecrets(f.reason) })),
      head_sha: pull.headSha,
      generated_at: new Date().toISOString(),
      provider: outcome.provider,
      model: outcome.model,
      cost_usd: outcome.costUsd,
      input_tokens: fit.tokens,
      tokens_estimated: fit.estimated,
      included_inputs: fit.blocks.map((b) => b.label),
      missing_inputs: [...new Set([...collected.missing, ...fit.dropped])],
      dropped_refs: droppedRisks + droppedFocus,
      index_complete: collected.indexComplete,
      index_reason: collected.indexReason,
    };

    await this.repo.upsertBrief(prId, doc);

    return { state: 'ok', brief: { ...doc, pr_id: prId, stale: false } };
  }
}
