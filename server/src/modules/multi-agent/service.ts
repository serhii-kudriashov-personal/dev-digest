import type { Container } from '../../platform/container.js';
import type { AgentHistoryRow, AgentLane, MultiAgentRunResult, MultiAgentRunSummary } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { MAX_AGENTS_PER_RUN, MAX_LANE_FINDINGS, MAX_LOCATIONS } from './constants.js';
import { findingRowToRecord, groupFindings, runTotals } from './helpers.js';
import { MultiAgentRepository } from './repository.js';

/**
 * Multi-agent review service (SPEC-05). Orchestrates:
 *   resolve + validate the agent selection
 *     → container.reviews.runReview(...)   (UNCHANGED — the reviews slice's
 *       existing sequential executor, reached through the composition root,
 *       the sanctioned cross-slice channel: `no-cross-slice-import` scopes
 *       its `from` to `^src/modules/`, so this file may not import
 *       `reviews/service.js` directly, but `container.reviews` may —
 *       `server/INSIGHTS.md` 2026-08-08)
 *     → record the multi_agent_runs row + its members
 *   plus the read side: the run list, one run's grouped results (AC-21…AC-28),
 *   and the agent-history feed for the Configure-run screen's estimate.
 */
export class MultiAgentService {
  private repo: MultiAgentRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
  }

  /**
   * Start a multi-agent run. The record is written BEFORE any member run
   * completes (AC-16) — `container.reviews.runReview` returns run ids
   * immediately and executes in the background (NFR-2).
   */
  async start(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Parameters<Container['reviews']['runReview']>[3],
  ): Promise<MultiAgentRunSummary> {
    // Defense in depth: `MultiAgentStartRequest.agent_ids` already caps this
    // at the Zod edge (422), but the cap is re-asserted here too.
    if (agentIds.length > MAX_AGENTS_PER_RUN) {
      throw new ValidationError(`At most ${MAX_AGENTS_PER_RUN} agents can be run at once`);
    }

    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Resolve by id, preserving the caller's order. A disabled agent resolves
    // exactly like an enabled one — the "disabled agent picked" edge case
    // holds for free, with no separate branch.
    const targets: AgentRow[] = [];
    for (const id of agentIds) {
      const agent = await this.container.agentsRepo.getById(workspaceId, id);
      if (!agent) throw new NotFoundError(`Agent ${id} not found`);
      targets.push(agent);
    }

    const { runs } = await this.container.reviews.runReview(workspaceId, prId, targets, logger);
    const run = await this.repo.createRun({ workspaceId, prId, headSha: pull.headSha });
    // `runReview` already resolved each agent's name before starting its run,
    // so it is carried on `runs[].agent_name` — recorded here as a SNAPSHOT
    // (AC-23), not re-read from `agents` on every future fetch.
    await this.repo.addMembers(
      run.id,
      runs.map((r) => ({ runId: r.run_id, agentName: r.agent_name })),
    );

    return {
      id: run.id,
      pr_id: prId,
      pr_number: pull.number,
      ran_at: run.ranAt.toISOString(),
      agent_count: runs.length,
      member_run_ids: runs.map((r) => r.run_id),
    };
  }

  /** All multi-agent runs for a PR, newest first (AC-17, AC-18, NFR-7). */
  async listForPull(workspaceId: string, prId: string): Promise<MultiAgentRunSummary[]> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const runs = await this.repo.listForPull(workspaceId, prId);
    return Promise.all(
      runs.map(async (run) => {
        const members = await this.repo.membersWithReviews(run.id);
        return {
          id: run.id,
          pr_id: run.prId,
          pr_number: pull.number,
          ran_at: run.ranAt.toISOString(),
          agent_count: members.length,
          member_run_ids: members.map((m) => m.runId),
        };
      }),
    );
  }

  /**
   * Assemble one run's full results: lanes, grouped locations and their
   * conflicts, and the run totals. `stale` is computed HERE, at read time,
   * never stored — same pattern as `IntentService#toDerived`
   * (`modules/intent/service.ts`).
   */
  async results(workspaceId: string, runId: string): Promise<MultiAgentRunResult> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Multi-agent run not found');
    const pull = await this.container.reviewRepo.getPull(workspaceId, run.prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const members = await this.repo.membersWithReviews(run.id);
    const lanes: AgentLane[] = members.map((m) => {
      const findings = m.findings.map(findingRowToRecord);
      return {
        run_id: m.runId,
        agent_id: m.agentId,
        agent_name: m.agentName,
        provider: m.provider,
        model: m.model,
        status: (m.status ?? 'queued') as AgentLane['status'],
        error: m.error,
        verdict: m.verdict,
        score: m.score,
        summary: m.summary,
        duration_ms: m.durationMs,
        cost_usd: m.costUsd,
        findings: findings.slice(0, MAX_LANE_FINDINGS),
        findings_total: findings.length,
      };
    });

    const allLocations = groupFindings(lanes);
    const { total_duration_ms, total_cost_usd } = runTotals(lanes);

    return {
      id: run.id,
      pr_id: run.prId,
      pr_number: pull.number,
      repo_id: pull.repoId,
      ran_at: run.ranAt.toISOString(),
      stale: run.headSha !== pull.headSha,
      lanes,
      locations: allLocations.slice(0, MAX_LOCATIONS),
      locations_total: allLocations.length,
      completed_lane_count: lanes.filter((l) => l.status === 'done').length,
      total_duration_ms,
      total_cost_usd,
    };
  }

  /**
   * Every agent in the workspace (enabled or not), with its last COMPLETED
   * run when it has one — feeds the Configure-run screen's per-agent history
   * card and pre-run estimate (AC-10, AC-11, Open question 6). An agent that
   * has never completed a run gets `last_run: null`, never a `0`.
   */
  async agentHistory(workspaceId: string): Promise<AgentHistoryRow[]> {
    const [agents, lastRuns] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.repo.lastCompletedRunPerAgent(workspaceId),
    ]);
    return agents.map((agent) => {
      const last = lastRuns.get(agent.id);
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        enabled: agent.enabled,
        model: agent.model,
        last_run: last
          ? {
              run_id: last.runId,
              ran_at: last.ranAt.toISOString(),
              duration_ms: last.durationMs,
              cost_usd: last.costUsd,
              summary: last.summary,
              pr_number: last.prNumber,
            }
          : null,
      };
    });
  }
}
