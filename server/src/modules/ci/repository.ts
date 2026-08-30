import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CiTarget } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * All `ci_installations` / `ci_runs` SQL (SPEC-05). Neither table carries its
 * own `workspace_id` — the `ci_installations → agents.workspace_id` join IS
 * the tenancy boundary (`backend-onion-architecture` §5). Every method takes
 * `workspaceId` and scopes on it. Returns plain rows only; nothing
 * Drizzle-shaped crosses this file's boundary.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

/** A `ci_runs` row joined with its installation's `repo` (the CI Runs view's
 *  repository column). The join already happens for tenancy scoping in
 *  `listRunsForWorkspace` / `listRunsForAgent` — this just also selects the
 *  column, so `repo` is only ever populated on rows those two methods return. */
export type CiRunWithRepo = CiRunRow & { repo: string | null };

export interface UpsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: CiTarget;
}

export interface UpsertRunInput {
  ciInstallationId: string;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  githubUrl: string;
  source: string;
}

export interface RunResultPatch {
  status: string;
  findingsCount: number | null;
  costUsd: number | null;
}

/**
 * What the export path needs to know about the target repository (SPEC-06 —
 * AC-48). Plain data: nothing Drizzle-shaped crosses this boundary.
 */
export interface CiTargetRepoRow {
  id: string;
  provider: string;
  instanceLabel: string;
}

export class CiRepository {
  constructor(private db: Db) {}

  /**
   * The imported repository an export names, or `null` when the workspace has
   * not imported it (SPEC-06 — AC-48).
   *
   * `repos.namespace_path === repos.full_name` by invariant, so one predicate
   * matches an `owner/name` and a nested GitLab namespace alike. `instanceId`
   * is part of the key rather than an afterthought: two instances may hold the
   * same namespace path, and `null` selects the built-in github.com host, which
   * is deliberately not a `git_instances` row — `IS NULL` and not `= NULL`.
   *
   * Reading `repos` from this slice's own repository follows the established
   * shape (`conventions`, `context`, `intent` and `brief` all do it): the SQL
   * stays inside a `repository.ts`, and no slice imports another slice's
   * private files (`backend-onion-architecture` §4, §5).
   */
  async findTargetRepo(
    workspaceId: string,
    fullName: string,
    instanceId: string | null,
  ): Promise<CiTargetRepoRow | null> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        provider: t.repos.provider,
        instanceLabel: t.repos.instanceKey,
      })
      .from(t.repos)
      .where(
        and(
          eq(t.repos.workspaceId, workspaceId),
          eq(t.repos.fullName, fullName),
          instanceId === null ? isNull(t.repos.instanceId) : eq(t.repos.instanceId, instanceId),
        ),
      );
    return row ?? null;
  }

  /**
   * Create-or-touch the (agent, repo) installation (AC-20). Throws
   * `NotFoundError` when the agent does not belong to the workspace — the
   * agentId in the URL is attacker-controlled (`security` §A01).
   */
  async upsertInstallation(
    workspaceId: string,
    input: UpsertInstallationInput,
  ): Promise<CiInstallationRow> {
    const [agent] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, input.agentId)));
    if (!agent) throw new NotFoundError('Agent not found');

    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: { installedAt: new Date() },
      })
      .returning();
    return row!;
  }

  /** An agent's own installations (AC-33). Scoped through the same join. */
  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationRow[]> {
    return this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .then((rows) => rows.map((r) => r.installation));
  }

  /** Every installation in the workspace — the refresh fan-out source. */
  async listInstallationsForWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .then((rows) => rows.map((r) => r.installation));
  }

  /**
   * Record a run GitHub reports if it has not been recorded before (AC-25).
   * `DO NOTHING` is cheaper than `DO UPDATE` when the row already exists —
   * a later result is attached separately via `updateRunResult`. Returns the
   * row either way (inserted or pre-existing), so the caller can read its
   * `id` and its current `findingsCount` to decide whether a result still
   * needs to be fetched.
   */
  async upsertRun(workspaceId: string, input: UpsertRunInput): Promise<CiRunRow> {
    // The workspace scope is enforced by the caller resolving `ciInstallationId`
    // from `listInstallationsForWorkspace` first; re-verified here so a stray
    // cross-workspace id can never insert a row.
    const [installation] = await this.db
      .select({ id: t.ciInstallations.id })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.id, input.ciInstallationId),
        ),
      );
    if (!installation) throw new NotFoundError('CI installation not found');

    const [inserted] = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: input.ciInstallationId,
        prNumber: input.prNumber,
        ranAt: input.ranAt,
        status: input.status,
        githubUrl: input.githubUrl,
        source: input.source,
      })
      .onConflictDoNothing({
        target: [t.ciRuns.ciInstallationId, t.ciRuns.githubUrl],
      })
      .returning();
    if (inserted) return inserted;

    // Conflict: the row already existed. `onConflictDoNothing` + `.returning()`
    // returns nothing on a conflict, so fetch the existing row by the same
    // unique key.
    const [existing] = await this.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, input.ciInstallationId),
          eq(t.ciRuns.githubUrl, input.githubUrl),
        ),
      );
    if (!existing) throw new NotFoundError('CI run not found after upsert');
    return existing;
  }

  /** Attach an ingested artifact's result to an already-recorded run. */
  async updateRunResult(workspaceId: string, runId: string, patch: RunResultPatch): Promise<void> {
    const [row] = await this.db
      .select({ id: t.ciRuns.id })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciRuns.id, runId)));
    if (!row) throw new NotFoundError('CI run not found');

    await this.db
      .update(t.ciRuns)
      .set({
        status: patch.status,
        findingsCount: patch.findingsCount,
        costUsd: patch.costUsd,
      })
      .where(eq(t.ciRuns.id, runId));
  }

  /** Every run in the workspace, newest first — explicit `ORDER BY` (a list
   *  feeding a client view with none reshuffles, `server/INSIGHTS.md` 2026-08-21). */
  async listRunsForWorkspace(workspaceId: string, limit: number): Promise<CiRunWithRepo[]> {
    return this.db
      .select({ run: t.ciRuns, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(limit)
      .then((rows) => rows.map((r) => ({ ...r.run, repo: r.repo })));
  }

  /** Every run for one agent's installations, newest first. */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<CiRunWithRepo[]> {
    return this.db
      .select({ run: t.ciRuns, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(desc(t.ciRuns.ranAt))
      .then((rows) => rows.map((r) => ({ ...r.run, repo: r.repo })));
  }
}
