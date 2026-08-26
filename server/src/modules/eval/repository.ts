import { and, count, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { EvalExpectationKind, EvalOwnerKind, EvalRunStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  EVAL_MAX_CASES_PER_AGENT,
  EVAL_MAX_HISTORY_RUNS,
  EVAL_MAX_RECENT_RUNS,
  EVAL_DETAIL_RETENTION_RUNS,
} from './constants.js';

/**
 * Eval slice data-access (L06, SPEC-04) — the ONLY file in this slice that may
 * import Drizzle or `db/schema`. Constructor takes `Db`, never `Container`.
 * Every method is workspace-scoped; nothing Drizzle-shaped (no query chain, no
 * `SQL` fragment, no transaction handle) crosses out — rows and plain values
 * only (`backend-onion-architecture` §5).
 *
 * `evalRuns` carries no `workspace_id` of its own — it is scoped through
 * `evalCases.workspaceId` or `evalSetRuns.workspaceId`, joined explicitly below.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalSetRunRow = typeof t.evalSetRuns.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export type InsertEvalCase = Omit<
  typeof t.evalCases.$inferInsert,
  'id' | 'workspaceId' | 'createdAt'
>;
export type UpdateEvalCase = Partial<InsertEvalCase>;

export interface OpenSetRunValues {
  agentId: string;
  configVersion: number;
  provider: string;
  model: string;
  /** Ordered — the identity AC-17 requires. */
  coveredCaseIds: string[];
}

export interface CloseSetRunValues {
  status: Extract<EvalRunStatus, 'complete' | 'incomplete'>;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesPassed: number;
  costUsd: number | null;
  durationMs: number | null;
  incompleteReason?: string | null;
}

export interface RecordCaseResultValues {
  caseId: string;
  setRunId?: string | null;
  actualOutput?: unknown;
  pass: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  error?: string | null;
  groundingDropped?: unknown;
  matched?: boolean | null;
}

/** The newest run's outcome for a case — enough to render "pass / fail / never run". */
export interface LatestCaseResult {
  pass: boolean | null;
  ranAt: Date;
  recall: number | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ----------------------------------------------------------

  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalCases.createdAt))
      .limit(EVAL_MAX_CASES_PER_AGENT);
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  async insertCase(workspaceId: string, values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({ ...values, workspaceId })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set(patch)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async countCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * The newest `eval_runs` row per case, in ONE query (not N) — uses the
   * `eval_runs_case_ran_idx` (case_id, ran_at desc) prefix via `selectDistinctOn`.
   */
  async latestCaseResults(
    workspaceId: string,
    caseIds: string[],
  ): Promise<Map<string, LatestCaseResult>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.evalRuns.caseId], {
        caseId: t.evalRuns.caseId,
        pass: t.evalRuns.pass,
        ranAt: t.evalRuns.ranAt,
        recall: t.evalRuns.recall,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), inArray(t.evalRuns.caseId, caseIds)))
      .orderBy(t.evalRuns.caseId, desc(t.evalRuns.ranAt));
    return new Map(rows.map((r) => [r.caseId, { pass: r.pass, ranAt: r.ranAt, recall: r.recall }]));
  }

  /** The most recent full `eval_runs` row for one case (AC-32's response —
   *  `latestCaseResults` above only returns the small summary shape). */
  async latestRunForCase(workspaceId: string, caseId: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.caseId, caseId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return row?.run;
  }

  // ---- eval_set_runs (AC-17 run identity) -----------------------------------

  async openSetRun(workspaceId: string, values: OpenSetRunValues): Promise<EvalSetRunRow> {
    const [row] = await this.db
      .insert(t.evalSetRuns)
      .values({
        workspaceId,
        agentId: values.agentId,
        configVersion: values.configVersion,
        provider: values.provider,
        model: values.model,
        coveredCaseIds: values.coveredCaseIds,
        casesCovered: values.coveredCaseIds.length,
        status: 'running',
      })
      .returning();
    return row!;
  }

  async bumpSetRunProgress(setRunId: string, casesDone: number): Promise<void> {
    await this.db.update(t.evalSetRuns).set({ casesDone }).where(eq(t.evalSetRuns.id, setRunId));
  }

  async recordCaseResult(values: RecordCaseResultValues): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        setRunId: values.setRunId ?? null,
        actualOutput: (values.actualOutput as object | undefined) ?? null,
        pass: values.pass,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
        error: values.error ?? null,
        groundingDropped: (values.groundingDropped as object | undefined) ?? null,
        matched: values.matched ?? null,
      })
      .returning();
    return row!;
  }

  async closeSetRun(setRunId: string, values: CloseSetRunValues): Promise<void> {
    await this.db
      .update(t.evalSetRuns)
      .set({
        status: values.status,
        finishedAt: new Date(),
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        casesPassed: values.casesPassed,
        costUsd: values.costUsd,
        durationMs: values.durationMs,
        incompleteReason: values.incompleteReason ?? null,
      })
      .where(eq(t.evalSetRuns.id, setRunId));
  }

  /** NFR-6: a run with zero executed cases is not recorded at all. */
  async deleteSetRun(setRunId: string): Promise<void> {
    await this.db.delete(t.evalSetRuns).where(eq(t.evalSetRuns.id, setRunId));
  }

  async getSetRun(workspaceId: string, setRunId: string): Promise<EvalSetRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSetRuns)
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.id, setRunId)));
    return row;
  }

  async listSetRuns(
    workspaceId: string,
    agentId: string,
    opts: { limit?: number } = {},
  ): Promise<EvalSetRunRow[]> {
    return this.db
      .select()
      .from(t.evalSetRuns)
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.agentId, agentId)))
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(opts.limit ?? EVAL_MAX_HISTORY_RUNS);
  }

  /** Cross-agent recent list (AC-42) — no agent predicate, uses the
   *  workspace-only composite index. */
  async listRecentSetRuns(
    workspaceId: string,
    opts: { limit?: number } = {},
  ): Promise<EvalSetRunRow[]> {
    return this.db
      .select()
      .from(t.evalSetRuns)
      .where(eq(t.evalSetRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(opts.limit ?? EVAL_MAX_RECENT_RUNS);
  }

  async listCaseResults(workspaceId: string, setRunId: string): Promise<EvalRunRow[]> {
    const rows = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalSetRuns, eq(t.evalRuns.setRunId, t.evalSetRuns.id))
      .where(
        and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalRuns.setRunId, setRunId)),
      );
    return rows.map((r) => r.run);
  }

  /** The newest still-`running` set run for an agent, for AC-30's message. */
  async runningSetRun(workspaceId: string, agentId: string): Promise<EvalSetRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSetRuns)
      .where(
        and(
          eq(t.evalSetRuns.workspaceId, workspaceId),
          eq(t.evalSetRuns.agentId, agentId),
          eq(t.evalSetRuns.status, 'running'),
        ),
      )
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(1);
    return row;
  }

  /** `(owner_id, count)` grouped over `eval_cases` where `owner_kind = 'agent'`
   *  — the dashboard's "which agents have a case set" read (AC-40, AC-44). */
  async agentsWithCases(workspaceId: string): Promise<{ agentId: string; count: number }[]> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, n: count() })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return rows.map((r) => ({ agentId: r.agentId, count: Number(r.n) }));
  }

  /**
   * NFR-8 retention: per-case detail (`eval_runs` rows) is pruned once a set
   * run falls outside the newest `EVAL_DETAIL_RETENTION_RUNS`; the set run
   * itself (with its denormalised metrics, AC-16) is only dropped once it
   * falls outside `EVAL_MAX_HISTORY_RUNS`. Two independent deletes — no
   * transaction: a partial prune is harmless and re-runs next time.
   */
  async pruneRetention(workspaceId: string, agentId: string): Promise<void> {
    const keepDetail = await this.db
      .select({ id: t.evalSetRuns.id })
      .from(t.evalSetRuns)
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.agentId, agentId)))
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(EVAL_DETAIL_RETENTION_RUNS);
    const keepDetailIds = keepDetail.map((r) => r.id);

    if (keepDetailIds.length > 0) {
      const toPrune = await this.db
        .select({ id: t.evalSetRuns.id })
        .from(t.evalSetRuns)
        .where(
          and(
            eq(t.evalSetRuns.workspaceId, workspaceId),
            eq(t.evalSetRuns.agentId, agentId),
            notInArray(t.evalSetRuns.id, keepDetailIds),
          ),
        );
      const pruneIds = toPrune.map((r) => r.id);
      if (pruneIds.length > 0) {
        await this.db.delete(t.evalRuns).where(inArray(t.evalRuns.setRunId, pruneIds));
        await this.db
          .update(t.evalSetRuns)
          .set({ detailPruned: true })
          .where(inArray(t.evalSetRuns.id, pruneIds));
      }
    }

    const keepHistory = await this.db
      .select({ id: t.evalSetRuns.id })
      .from(t.evalSetRuns)
      .where(and(eq(t.evalSetRuns.workspaceId, workspaceId), eq(t.evalSetRuns.agentId, agentId)))
      .orderBy(desc(t.evalSetRuns.ranAt))
      .limit(EVAL_MAX_HISTORY_RUNS);
    const keepHistoryIds = keepHistory.map((r) => r.id);
    if (keepHistoryIds.length > 0) {
      await this.db
        .delete(t.evalSetRuns)
        .where(
          and(
            eq(t.evalSetRuns.workspaceId, workspaceId),
            eq(t.evalSetRuns.agentId, agentId),
            notInArray(t.evalSetRuns.id, keepHistoryIds),
          ),
        );
    }
  }
}

// Re-exported so the service (ring 2) can name the case-side expectation kind
// without importing `@devdigest/shared` for it a second time.
export type { EvalExpectationKind };
