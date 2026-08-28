import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

/**
 * Registered forge instances (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`).
 *
 * One row per operator-registered forge a workspace may import repositories
 * from. Column types follow `postgresql-table-design`: `TEXT` never
 * `varchar(n)`, `TIMESTAMPTZ` never bare `timestamp`.
 *
 * NO COLUMN HERE STORES AUTHENTICATION MATERIAL (AC-10). What an instance is
 * registered with lives only in `SecretsProvider`, under the key
 * `instanceSecretKey(id)` — see `modules/instances/constants.ts`.
 */
export const gitInstances = pgTable(
  'git_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Mirrors the `RepoProvider` contract enum; `github` is reserved for the
     *  built-in host, which is not registered as a row today. */
    provider: text('provider', { enum: ['github', 'gitlab'] }).notNull(),
    /** Normalized origin + optional path prefix, no trailing slash. */
    baseUrl: text('base_url').notNull(),
    /**
     * Filesystem-safe slug derived from `baseUrl` — the clone-path segment and
     * the repository-identity discriminator Stage B's unique index uses.
     *
     * `NOT NULL` on purpose: a `UNIQUE` index treats NULLs as distinct, so a
     * nullable instance reference could never carry the dedupe invariant.
     */
    instanceKey: text('instance_key').notNull(),
    label: text('label').notNull(),
    /** From the instance's own metadata endpoint; null until verified. */
    version: text('version'),
    /** The CE/EE codebase flag, NOT the licensed tier — reading the tier needs
     *  administrator access, which an integration never has
     *  (root `INSIGHTS.md` 2026-08-28). */
    edition: text('edition'),
    /** Mirrors the `ApprovalCapability` contract enum. `unknown` is the honest
     *  default: an unprobed instance is not a refusing one. */
    approvalCapability: text('approval_capability', {
      enum: ['permitted', 'refused', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => [
    // One registration per base URL per workspace — the identity a repository
    // URL is matched against (AC-13), so it has to be single-valued.
    uniqueIndex('git_instances_ws_base_uq').on(t.workspaceId, t.baseUrl),
    // …and one per derived key, so two base URLs can never collapse onto one
    // clone-path segment (AC-17).
    uniqueIndex('git_instances_ws_key_uq').on(t.workspaceId, t.instanceKey),
    // PostgreSQL does NOT auto-index a foreign key column; the workspace-scoped
    // list query needs this explicitly (`postgresql-table-design` §Indexing).
    index('git_instances_ws_idx').on(t.workspaceId),
  ],
);
