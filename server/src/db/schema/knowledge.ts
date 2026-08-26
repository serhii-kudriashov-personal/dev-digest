import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * Extracted house-rule candidates, one row per rule.
 *
 * `status` is tri-state rather than the original `accepted boolean` because a
 * re-scan has to preserve BOTH verdicts: clearing only `pending` rows is what
 * stops an accepted rule reappearing as a duplicate and a rejected one coming
 * back forever. Two booleans would have made `(accepted, rejected) = (t, t)`
 * representable, and every read would then defend against a meaningless state.
 *
 * The evidence columns are written by the server, never by the model: the line
 * range is computed from where the snippet was actually found in the file (see
 * `modules/conventions/helpers.ts` → `groundEvidence`). A candidate whose
 * evidence cannot be located is dropped, so it has no row here at all.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    category: text('category', {
      enum: ['naming', 'error-handling', 'structure', 'testing', 'api-shape', 'tooling', 'other'],
    })
      .notNull()
      .default('other'),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    /** 1-based, inclusive. Server-computed from the snippet's match offset. */
    evidenceLineStart: integer('evidence_line_start'),
    evidenceLineEnd: integer('evidence_line_end'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: now(),
  },
  // A FK is not an index in Postgres, and the list query filters on both
  // columns — see server/INSIGHTS.md (2026-08-0x, the `findings` table).
  (t) => ({ wsRepoIdx: index('conventions_ws_repo_idx').on(t.workspaceId, t.repoId) }),
);

/**
 * Append-only audit trail of extraction runs. One row per scan, including a scan
 * that produced nothing.
 *
 * `dropped` is stored deliberately: it is how many candidates the model claimed
 * that the evidence gate could not prove. A model that systematically invents
 * evidence must not look like one that never does.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    filesSampled: integer('files_sampled').notNull(),
    candidates: integer('candidates').notNull(),
    dropped: integer('dropped').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    createdAt: now(),
  },
  (t) => ({ wsRepoIdx: index('convention_scans_ws_repo_idx').on(t.workspaceId, t.repoId) }),
);
