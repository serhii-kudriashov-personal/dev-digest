import { desc } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // At most one installation per agent and repository (SPEC-05 AC-20); also the
  // ON CONFLICT target the install upsert needs.
  (t) => [uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo)],
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
  },
  (t) => [
    // Records every run the installation has not recorded before (AC-25); also
    // the ON CONFLICT target the ingest upsert needs. `github_url` must be
    // NOT NULL-checked by the service before persisting a run, or a UNIQUE
    // index does not deduplicate against multiple NULLs.
    uniqueIndex('ci_runs_installation_url_uq').on(t.ciInstallationId, t.githubUrl),
    // The list read, newest first.
    index('ci_runs_installation_ran_idx').on(t.ciInstallationId, desc(t.ranAt)),
  ],
);
