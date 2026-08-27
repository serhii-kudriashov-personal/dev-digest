import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

/**
 * The multi-agent slice's ONLY layer touching the DB (SPEC-05). Owns
 * `multi_agent_runs` + `multi_agent_run_members`; reads (never writes)
 * `agent_runs`, `reviews`, `findings`, `agents` and `pull_requests`.
 * Workspace-scoped throughout — `getRun` and `listForPull` both filter by
 * `workspace_id` (AC-20).
 */

export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;

/** One member's lane, pre-DTO — nothing Drizzle-shaped in this shape. */
export interface MemberWithReview {
  runId: string;
  position: number;
  agentId: string | null;
  agentName: string;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  verdict: string | null;
  score: number | null;
  summary: string | null;
  findings: FindingRow[];
}

export interface LastCompletedRun {
  agentId: string;
  runId: string;
  ranAt: Date;
  durationMs: number | null;
  costUsd: number | null;
  summary: string | null;
  prNumber: number | null;
}

export class MultiAgentRepository {
  constructor(private db: Db) {}

  async createRun(values: { workspaceId: string; prId: string; headSha: string }): Promise<MultiAgentRunRow> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: values.workspaceId, prId: values.prId, headSha: values.headSha })
      .returning();
    return row!;
  }

  /**
   * Records the selection order as `position` — that order is what the lanes
   * render in. `agentName` is a SNAPSHOT taken at run-start time (AC-23): it
   * is written once here and never updated, so it survives the agent being
   * renamed or hard-deleted later (`AgentsRepository.deleteById`).
   */
  async addMembers(multiAgentRunId: string, members: { runId: string; agentName: string }[]): Promise<void> {
    if (members.length === 0) return;
    await this.db.insert(t.multiAgentRunMembers).values(
      members.map((m, position) => ({
        multiAgentRunId,
        runId: m.runId,
        agentName: m.agentName,
        position,
      })),
    );
  }

  /** All multi-agent runs for a PR (any state), newest first (AC-17, AC-18, NFR-7). */
  async listForPull(workspaceId: string, prId: string): Promise<MultiAgentRunRow[]> {
    return this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt));
  }

  /** Workspace-scoped lookup by id — an out-of-workspace id returns `undefined`
   *  and the service turns that into a 404 that discloses nothing (AC-20). */
  async getRun(workspaceId: string, id: string): Promise<MultiAgentRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
    return row;
  }

  /**
   * Every member run in a multi-agent run, in selection order, each with its
   * review's verdict/score/summary and findings. A member with no `reviews`
   * row (nothing yet, or the run failed before persisting one) is a lane with
   * `verdict`/`score`/`summary`/`findings` all empty — normal, not an error
   * (root `INSIGHTS.md` 2026-08-02: an `agent_runs` row and its `reviews` row
   * can each outlive the other).
   */
  async membersWithReviews(multiAgentRunId: string): Promise<MemberWithReview[]> {
    const memberRows = await this.db
      .select({
        runId: t.multiAgentRunMembers.runId,
        position: t.multiAgentRunMembers.position,
        run: t.agentRuns,
        // The recorded-at-run-start snapshot (AC-23) — the primary source.
        agentNameSnapshot: t.multiAgentRunMembers.agentName,
        // Only reached for a row written before the snapshot column existed
        // (none today — the table was empty until this feature). Kept as a
        // fallback rather than removed, so such a row still names its agent
        // until it is actually deleted.
        liveAgentName: t.agents.name,
        reviewId: t.reviews.id,
        verdict: t.reviews.verdict,
        score: t.reviews.score,
        summary: t.reviews.summary,
      })
      .from(t.multiAgentRunMembers)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.multiAgentRunMembers.runId))
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .where(eq(t.multiAgentRunMembers.multiAgentRunId, multiAgentRunId))
      .orderBy(asc(t.multiAgentRunMembers.position));

    const reviewIds = memberRows
      .map((r) => r.reviewId)
      .filter((id): id is string => id != null);
    const findingRows = reviewIds.length
      ? await this.db
          .select()
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
          .orderBy(asc(t.findings.id))
      : [];

    return memberRows.map((m) => ({
      runId: m.runId,
      position: m.position,
      agentId: m.run.agentId,
      // Snapshot first (AC-23) — survives the agent being deleted or renamed
      // after this run started. `liveAgentName` only covers a pre-snapshot
      // row, and 'Deleted agent' is the absolute last resort when neither is
      // available (both a hard-deleted agent and no recorded snapshot).
      agentName: m.agentNameSnapshot ?? m.liveAgentName ?? 'Deleted agent',
      provider: m.run.provider,
      model: m.run.model,
      status: m.run.status,
      error: m.run.error,
      durationMs: m.run.durationMs,
      costUsd: m.run.costUsd,
      verdict: m.verdict,
      score: m.score,
      summary: m.summary,
      findings: m.reviewId ? findingRows.filter((f) => f.reviewId === m.reviewId) : [],
    }));
  }

  /**
   * Every agent's newest COMPLETED (`status = 'done'`) run, keyed by agent id
   * — feeds `agentHistory` (AC-10, AC-11). Agents with no completed run are
   * simply absent from the map; the service fills every agent in regardless.
   */
  async lastCompletedRunPerAgent(workspaceId: string): Promise<Map<string, LastCompletedRun>> {
    const rows = await this.db
      .select({ run: t.agentRuns, summary: t.reviews.summary, prNumber: t.pullRequests.number })
      .from(t.agentRuns)
      .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')))
      .orderBy(desc(t.agentRuns.ranAt));

    const latest = new Map<string, LastCompletedRun>();
    for (const row of rows) {
      const agentId = row.run.agentId;
      if (!agentId || latest.has(agentId)) continue; // first hit per agent = newest (ORDER BY ran_at DESC)
      latest.set(agentId, {
        agentId,
        runId: row.run.id,
        ranAt: row.run.ranAt,
        durationMs: row.run.durationMs,
        costUsd: row.run.costUsd,
        summary: row.summary,
        prNumber: row.prNumber,
      });
    }
    return latest;
  }
}
