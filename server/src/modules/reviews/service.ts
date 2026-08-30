import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  PostBackOutcome,
  ReviewPostBack,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { buildReviewPublication, reviewToDto, toPostBackDto } from './helpers.js';

/**
 * Single-flight de-duplication for posting a review back (SPEC-06 — NFR-8).
 *
 * Keyed by `<runId>:<prId>`, which is the identity of one post-back: two
 * simultaneous posts of the SAME run to the SAME change request collapse into
 * one publication, and two different runs are unconstrained.
 *
 * Module-level, deliberately, and for a stronger reason than the caller's
 * lifetime: `ReviewService` is constructed in at least two places (`routes.ts`
 * at registration, and `container.reviews`), so an instance field would leave
 * NFR-8 true only for callers that happened to share an instance. Same shape as
 * `BriefService`'s map, and the same caveat applies — it collapses concurrency
 * within ONE Node process, which is what DevDigest is, and a test that fires
 * this without awaiting leaks a promise into the next case
 * (`server/INSIGHTS.md` 2026-08-17).
 */
const postBackInFlight = new Map<string, Promise<ReviewPostBack>>();

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Posting a review back to its change request (SPEC-06 — AC-34…AC-41)
  // ===========================================================================

  /** The recorded post-back outcome for a run, so a reload can show it (NFR-12). */
  async getPostBack(
    workspaceId: string,
    prId: string,
    runId: string,
  ): Promise<ReviewPostBack | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const row = await this.repo.getPostBack(prId, runId);
    return row ? toPostBackDto(row) : null;
  }

  /**
   * Publish one run's review onto its change request and record how that ended.
   *
   * NEVER throws for a publication that did not work out. The four outcomes are
   * the answer (AC-39), so a missing access token, an offline instance or a
   * refused approval all come back as a recorded outcome with a stated reason —
   * the same shape `BriefGenerationResult` uses for its degraded states. Only a
   * genuinely unanswerable request (an unknown pull, an unknown run) is an
   * `AppError`.
   *
   * Single-flight per `(runId, prId)` (NFR-8): a second concurrent post joins
   * the first rather than publishing a second set of notes.
   */
  async postReviewBack(
    workspaceId: string,
    prId: string,
    runId: string,
  ): Promise<ReviewPostBack> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const found = await this.repo.reviewForRun(prId, runId);
    if (!found) throw new NotFoundError('That run produced no review to post');

    const key = `${runId}:${prId}`;
    const existing = postBackInFlight.get(key);
    if (existing) return existing;

    const run = this.doPostReviewBack(repo, pull.number, prId, runId, found);
    postBackInFlight.set(key, run);
    try {
      return await run;
    } finally {
      postBackInFlight.delete(key);
    }
  }

  private async doPostReviewBack(
    repo: NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>,
    number: number,
    prId: string,
    runId: string,
    found: NonNullable<Awaited<ReturnType<ReviewRepository['reviewForRun']>>>,
  ): Promise<ReviewPostBack> {
    const { publication, truncated } = buildReviewPublication(found.review, found.findings);

    let outcome: PostBackOutcome = 'not_posted';
    let reason: string | null = null;
    let notesPublished = 0;
    try {
      // `instanceKey` is not optional in practice — absent it selects the legacy
      // github.com clone layout, which for a non-github.com row is a DIFFERENT
      // repository (`@devdigest/shared` `RepoRef`, root `INSIGHTS.md` 2026-08-29).
      const forge = await this.container.forge(repo);
      const result = await forge.publishReview(
        { owner: repo.owner, name: repo.name, instanceKey: repo.instanceKey },
        number,
        publication,
      );
      outcome = result.outcome;
      reason = result.reason;
      notesPublished = result.notesPublished;
    } catch (err) {
      // `ConfigError` from `container.forge` is a normal path (no token stored,
      // the instance de-registered), and so is a forge that threw instead of
      // reporting. Either way nothing was published.
      reason =
        err instanceof Error
          ? err.message
          : 'DevDigest could not reach the forge that owns this repository.';
    }

    if (truncated > 0) {
      // NFR-3: the cap is stated, never silent. Appended rather than replacing,
      // because a refused approval and a truncated post can both be true.
      const capNote =
        `Only the ${publication.notes.length} most severe findings were posted as inline ` +
        `notes; ${truncated} more remain in DevDigest.`;
      reason = reason ? `${reason} ${capNote}` : capNote;
    }

    const row = await this.repo.recordPostBack({
      runId,
      prId,
      outcome,
      reason,
      notesPublished,
    });
    return toPostBackDto(row);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
