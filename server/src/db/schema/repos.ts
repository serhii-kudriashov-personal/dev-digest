import { pgTable, uuid, text, timestamp, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';
import { gitInstances } from './instances';

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
    /**
     * SPEC-06 — repository identity beyond `owner/name`.
     *
     * All four carry a NON-VOLATILE `NOT NULL DEFAULT` (except the nullable FK),
     * so the migration backfills every pre-feature row without a table rewrite
     * and without one line of DML — which is the whole of AC-19
     * (`postgresql-table-design` §Safe Schema Evolution).
     */
    provider: text('provider', { enum: ['github', 'gitlab'] })
      .notNull()
      .default('github'),
    /**
     * The registered instance this repository was imported from. NULL means the
     * built-in github.com host, which is deliberately not a `git_instances` row.
     * `restrict` because deleting an instance out from under its repositories
     * would orphan their clones and their identity.
     */
    instanceId: uuid('instance_id').references(() => gitInstances.id, { onDelete: 'restrict' }),
    /**
     * Copy of the owning instance's `instance_key` — `github.com` for the
     * built-in host. It is duplicated here rather than joined for two reasons:
     * the clone path needs it without a join (`clonePathFor`, AC-17), and a
     * `UNIQUE` index treats NULLs as DISTINCT, so an index over the nullable
     * `instance_id` could not carry the dedupe invariant at all.
     */
    instanceKey: text('instance_key').notNull().default('github.com'),
    /**
     * The repository's path within its instance at any depth (`group/sub/proj`),
     * provider-neutral name for what `full_name` already holds.
     *
     * INVARIANT, and the reason the unique index below names `full_name` and not
     * this column: `namespace_path === full_name === owner/name` for every row,
     * on every provider — a nested GitLab namespace simply puts several segments
     * in `owner` (`group/sub` + `proj`). `repos/service.ts#add` writes both from
     * one value.
     *
     * It defaults to `''` because a column DEFAULT cannot reference another
     * column, so a pre-feature row cannot be given `full_name` here without DML
     * — and DML in a migration is exactly what AC-19 is meant to avoid. Readers
     * therefore treat `''` as "same as `full_name`" (`helpers.ts#toRepoDto`).
     */
    namespacePath: text('namespace_path').notNull().default(''),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    /**
     * SPEC-06 AC-44 / NFR-7 — why the last sync attempt against this
     * repository's forge failed, or NULL when the last attempt succeeded.
     *
     * NULLABLE and undefaulted on purpose: NULL is "no failure on record",
     * which is what every pre-feature row means and what a successful sync
     * writes back. Without it a read of `GET /repos/:id/pulls` cannot tell a
     * stale snapshot after a failed sync from an empty project — the failure
     * was only ever visible in the poll RESPONSE, which a page load never sees.
     *
     * THE VALUE IS THIRD-PARTY-INFLUENCED TEXT: it originates in a forge's own
     * error. It is capped and redacted by `_shared/sync-error.ts#toSyncError`
     * before it reaches this column — never write a raw `err.message` here.
     */
    lastSyncError: text('last_sync_error'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    /**
     * Identity is (workspace, instance, path within the instance) — AC-16. It
     * REPLACES `repos_ws_fullname_uq`, which could not tell `group/proj` on two
     * instances apart.
     *
     * The third column is `full_name` rather than `namespace_path` because the
     * two are equal by construction (see the column's docblock) and only
     * `full_name` is already populated on every pre-feature row. Indexing the
     * `''`-defaulted column instead would make the migration fail on any
     * workspace that already holds two repositories — every one of them would
     * collide on `('github.com', '')` — and fixing that needs the UPDATE that
     * AC-19 exists to avoid.
     */
    uq: uniqueIndex('repos_ws_instance_path_uq').on(t.workspaceId, t.instanceKey, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
    /** PostgreSQL does NOT auto-index a foreign key column. */
    instanceIdx: index('repos_instance_idx').on(t.instanceId),
  }),
);
