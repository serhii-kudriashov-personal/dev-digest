import { desc } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /**
   * Attributed USD cost of this run (sum over its LLM calls). NULL means
   * "unknown", not "free": failed/cancelled runs and rows that pre-date the
   * L01 restore both land here, and the UI renders them as "—".
   */
  costUsd: doublePrecision('cost_usd'),
  status: text('status'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
  },
  // `agent_runs` had NO indexes at all, while being read on every PR-detail load
  // and by the PR list's cost rollup (which polls every 60s).
  (t) => [
    // `listRuns` — (workspace_id, pr_id) ordered by ran_at desc. The same index
    // serves `activeRuns`, which adds `status` on the identical prefix.
    index('agent_runs_ws_pr_ran_idx').on(t.workspaceId, t.prId, desc(t.ranAt)),
    // PR-list cost rollup: `pr_id IN (…) AND cost_usd IS NOT NULL`, with no
    // workspace predicate, so the composite index above cannot serve it.
    index('agent_runs_pr_idx').on(t.prId),
  ],
);

/**
 * Which skills a run actually injected into its prompt, and in what order.
 *
 * The DETERMINISTIC half of skill provenance: the executor knows exactly what it
 * put in the prompt, so unlike `findings.skill_id` (which the model reports and
 * the server validates) nothing here is inferred. It is what makes "how often is
 * this skill pulled" and "how many runs has it seen" answerable at all.
 *
 * `version` is recorded because a skill's body is mutable and versioned: without
 * it a run tells you THAT a skill was used but not which wording it was scored
 * against, which is precisely what the Versions tab promises to preserve.
 */
export const runSkills = pgTable(
  'run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    /** `skills.version` at injection time. */
    version: integer('version').notNull(),
    /** Position within the `## Skills / rules` section. */
    order: integer('order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.skillId] }),
    // Per-skill reads (usage count, pull rate) filter on skill_id alone, which
    // the (run_id, skill_id) primary key cannot serve.
    index('run_skills_skill_idx').on(t.skillId),
  ],
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  /** The pull's head_sha at launch time — staleness (AC-46) is derived at read
   *  time by comparing this against the pull's CURRENT head_sha; never stored. */
  headSha: text('head_sha').notNull(),
});

/**
 * Membership of an `agent_runs` row in a `multi_agent_runs` run (SPEC-05).
 * Kept as a separate link table rather than a column on `agent_runs` so
 * `ReviewRepository.createAgentRun`'s signature stays untouched (the facade
 * already re-declares one delegated signature by hand — `server/INSIGHTS.md`
 * 2026-08-02 — and this avoids adding a second).
 */
export const multiAgentRunMembers = pgTable(
  'multi_agent_run_members',
  {
    multiAgentRunId: uuid('multi_agent_run_id')
      .notNull()
      .references(() => multiAgentRuns.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    /** Preserves the selection order the lanes render in. */
    position: integer('position').notNull().default(0),
    /**
     * SNAPSHOT of the agent's name at the moment this run started (AC-23).
     * `agents.id` is a hard delete and `agent_runs.agent_id` is
     * `onDelete: 'set null'`, so once an agent is deleted there is no row
     * left to name it from — this column is what keeps the lane's identity
     * intact after that. Nullable only because rows written before this
     * column existed have nothing to backfill it from; every row inserted
     * from here on carries it (`MultiAgentRepository.addMembers`).
     */
    agentName: text('agent_name'),
  },
  (t) => [
    primaryKey({ columns: [t.multiAgentRunId, t.runId] }),
    // The composite PK serves `WHERE multi_agent_run_id = ?` as a leftmost
    // prefix, but leaves the reverse lookup (`WHERE run_id = ?`) unindexed —
    // `server/INSIGHTS.md` 2026-08-16.
    index('multi_agent_run_members_run_idx').on(t.runId),
  ],
);
