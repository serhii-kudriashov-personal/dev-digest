import { desc } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // ---- expectation (L06, SPEC-04) — nullable: a case created before this
    // lesson, or hand-authored without one, is presented as "needs repair"
    // rather than silently treated as must-find (see eval/helpers.ts).
    expectationKind: text('expectation_kind', { enum: ['must_find', 'must_not_flag'] }),
    expectFile: text('expect_file'),
    expectStartLine: integer('expect_start_line'),
    expectEndLine: integer('expect_end_line'),
    // ---- provenance (AC-6, AC-7) — deliberately NO `.references()`: a case
    // must keep running (and report `provenance.available: false`) after its
    // source finding/PR is deleted. Precedent: `reviews.runId` ("no FK by
    // design", `db/schema/reviews.ts`).
    sourceFindingId: uuid('source_finding_id'),
    sourcePrId: uuid('source_pr_id'),
    sourcePrNumber: integer('source_pr_number'),
    sourceRepoFullName: text('source_repo_full_name'),
    sourceHeadSha: text('source_head_sha'),
    runOnSave: boolean('run_on_save').notNull().default(false),
    createdAt: now(),
  },
  // Every case-set read filters on exactly this triple (list, count, run).
  (t) => [index('eval_cases_ws_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId)],
);

/**
 * A run of an agent's WHOLE case set (AC-17). One row per "run this set",
 * carrying its own denormalised metrics — the record of truth, NEVER
 * recomputed by joining `evalRuns` (whose `case_id` cascades away when a case
 * is deleted, per AC-16).
 */
export const evalSetRuns = pgTable(
  'eval_set_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    configVersion: integer('config_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    coveredCaseIds: jsonb('covered_case_ids').notNull().$type<string[]>(),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status', { enum: ['running', 'complete', 'incomplete'] }).notNull(),
    incompleteReason: text('incomplete_reason'),
    // Nullable = unknown, never 0 (root INSIGHTS.md 2026-08-02).
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    casesPassed: integer('cases_passed').notNull().default(0),
    casesCovered: integer('cases_covered').notNull().default(0),
    casesDone: integer('cases_done').notNull().default(0),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    // True once NFR-8 retention has pruned this run's per-case `eval_runs` rows.
    detailPruned: boolean('detail_pruned').notNull().default(false),
  },
  (t) => [
    // Per-agent history, trend and dashboard (newest first).
    index('eval_set_runs_ws_agent_ran_idx').on(t.workspaceId, t.agentId, desc(t.ranAt)),
    // Cross-agent recent list (AC-42) has no agent predicate, so the composite
    // above can't serve it.
    index('eval_set_runs_ws_ran_idx').on(t.workspaceId, desc(t.ranAt)),
  ],
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    // Nullable: a single-case run (AC-32) belongs to no set run.
    setRunId: uuid('set_run_id').references(() => evalSetRuns.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
    groundingDropped: jsonb('grounding_dropped'),
    matched: boolean('matched'),
  },
  (t) => [
    // "Most recent run per case" (AC-10, AC-11).
    index('eval_runs_case_ran_idx').on(t.caseId, desc(t.ranAt)),
    // A FK is not an index — the per-case detail read and the retention prune
    // both filter on this column.
    index('eval_runs_set_run_idx').on(t.setRunId),
  ],
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
