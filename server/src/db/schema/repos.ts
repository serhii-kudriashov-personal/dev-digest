import { pgTable, uuid, text, timestamp, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    clonePath: text('clone_path'),
    /**
     * Project Context (SPEC-01) search roots — the globs Markdown discovery
     * matches against, per repository.
     *
     * NULLABLE on purpose, and deliberately NOT defaulted: NULL means "never
     * configured, use DEFAULT_CONTEXT_ROOTS", which stays distinguishable from
     * "configured to exactly the default". Narrowing the roots only changes what
     * the listing shows — it never deletes an attachment row.
     */
    contextRoots: jsonb('context_roots').$type<string[]>(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('repos_ws_fullname_uq').on(t.workspaceId, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
  }),
);
