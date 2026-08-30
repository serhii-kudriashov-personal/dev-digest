import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  // Same reasoning as `findings` below: a foreign key is not an index. Both of
  // these back queries on the hottest path in the app — the PR list polls every
  // 60s and rolls up scores and severities across every PR in the workspace.
  (t) => [
    // PR-list score rollup (`pr_id IN (…) AND kind = 'review'` ordered by
    // created_at) and `reviewsForPull`, which uses the `pr_id` prefix.
    index('reviews_pr_kind_idx').on(t.prId, t.kind),
    // `run_id` has no FK by design (a run and its review can outlive each
    // other), so nothing indexed it — yet deleting a run looks its review up
    // by exactly this column.
    index('reviews_run_id_idx').on(t.runId),
  ],
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    /**
     * The skill whose rule this finding applies, when one can be established.
     *
     * The model names a skill slug and the server keeps it ONLY if that skill was
     * actually injected into the run that produced this finding (see
     * `resolveSkillAttribution`). Anything unverifiable lands NULL and is counted
     * as unattributed — a self-reported field is checked against something the
     * server knows, or it is not stored.
     *
     * `set null`, deliberately unlike every other skill FK, which cascade: a
     * finding is a historical fact about a review, so deleting a skill must not
     * delete the findings raised while it existed.
     */
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    /** AC-43 "Learn" intent. Nullable, no index — nothing filters on it yet. */
    learnedAt: timestamp('learned_at', { withTimezone: true }),
  },
  // A foreign key is NOT an index — Postgres auto-indexes primary keys and
  // unique constraints only. Every read of findings joins or filters on
  // review_id (reviewsForPull, and the PR list's severity rollup), so without
  // this the table is scanned in full each time.
  // A foreign key is NOT an index (see above). Every per-skill stat read filters
  // on skill_id — accept rate, findings-by-category, the 30-day count — so this
  // one earns its keep for the same reason review_id does.
  (t) => [
    index('findings_review_id_idx').on(t.reviewId),
    index('findings_skill_id_idx').on(t.skillId),
  ],
);

/**
 * The outcome of posting one review run back to its change request (SPEC-06 —
 * AC-39, AC-40, AC-41, NFR-12).
 *
 * A NEW table, not a column on `reviews` and not `composed_reviews`: the latter
 * is one of the reserved empty tables (`AGENTS.md` §Do not touch) and belongs to
 * a later lesson, and the run's own persisted document is jsonb that every
 * existing run already wrote (root `INSIGHTS.md` 2026-08-11).
 *
 * No `workspace_id` column, matching `findings` / `pr_files` / `pr_commits`: the
 * row is reachable only through `pr_id`, and every read and write here resolves
 * that pull workspace-scoped first. Adding a second copy of the tenant would
 * make two answers possible to one question.
 *
 * `run_id` carries no foreign key, deliberately and for the same reason
 * `reviews.run_id` carries none — a run row and the review it produced can each
 * outlive the other (root `INSIGHTS.md` 2026-08-02).
 */
export const reviewPostbacks = pgTable(
  'review_postbacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The `agent_runs` row whose review was published. No FK — see above. */
    runId: uuid('run_id').notNull(),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** A `PostBackOutcome` value. TEXT, not a pg enum: the states are owned by
     *  the contract, and extending a pg enum costs a migration. */
    outcome: text('outcome').notNull(),
    /** Prose for the user (AC-38, AC-41, NFR-3). Null when the outcome says
     *  everything there is to say. */
    reason: text('reason'),
    /** Notes that actually landed, summary note included (AC-40). */
    notesPublished: integer('notes_published').notNull().default(0),
    createdAt: now(),
  },
  (t) => [
    // One row per run per change request: re-posting a run REPLACES its outcome
    // rather than accumulating, because the question the UI asks is "how did
    // this run's post-back end", which has exactly one current answer (NFR-12).
    // Also indexes the `run_id` lookup by prefix.
    uniqueIndex('review_postbacks_run_pr_uq').on(t.runId, t.prId),
    // A foreign key is NOT an index. "Every post-back for this pull request"
    // filters on `pr_id` alone, which the composite above cannot serve.
    index('review_postbacks_pr_idx').on(t.prId),
  ],
);

// Derivation metadata (L03) is all NULLABLE and purely additive: rows written
// before L03 have no value for any of it, and a nullable column with no
// volatile default does not rewrite the table.
//
// NO INDEX, deliberately: `pr_id` is the primary key and every read here is
// `WHERE pr_id = $1`.
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // The commit the intent was derived from. This is what makes "the PR moved,
  // re-derive" a decidable question rather than a guess — compare it against
  // `pull_requests.head_sha`.
  headSha: text('head_sha'),
  // DETERMINISTIC tier ('high' | 'medium' | 'low'), computed server-side from
  // which sources were actually present. Text, not an enum type: the tiers are
  // owned by the contract, and a pg enum would need a migration to extend.
  confidence: text('confidence'),
  // The model's own self-rated confidence — stored, never trusted, never shown.
  modelConfidence: doublePrecision('model_confidence'),
  // Source LABELS only, never the content that was sent.
  sources: jsonb('sources').$type<string[]>(),
  provider: text('provider'),
  model: text('model'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
