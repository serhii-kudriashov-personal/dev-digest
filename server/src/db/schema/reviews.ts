import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
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

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
