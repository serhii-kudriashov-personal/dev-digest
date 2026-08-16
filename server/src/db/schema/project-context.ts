import { pgTable, uuid, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';

/**
 * Project Context (SPEC-01) — attachment tables.
 *
 * A "context document" is Markdown discovered in the repository's local mirror;
 * nothing about the document itself is stored here, only WHICH document is
 * attached to WHICH owner and in what order. The mirror stays the source of
 * truth for content (it hard-resets on sync, so anything cached here would be a
 * lie), and a stored path whose file has since disappeared is a `missing`
 * attachment, not a broken row.
 *
 * NOT `schema/context.ts` — that file already exists and owns the code-index
 * tables (`code_chunks` / `symbols` / `references` / `onboarding`), which this
 * feature does not touch: Markdown is never chunked, indexed or embedded.
 *
 * Shape follows `agent_skills` (`schema/agents.ts`): composite PK + an `order`
 * integer. The composite PK is what makes "a document appears at most once per
 * owner" a DATABASE invariant instead of application code, and its leading
 * column already indexes the `WHERE agent_id = ?` read — so no separate FK
 * index is owed here.
 */

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Repo-relative posix path into the mirror. */
    path: text('path').notNull(),
    /** Injection order within the owner's list; renumbered from 0 on replace. */
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.path] }) }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.path] }) }),
);
