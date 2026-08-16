import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { OrderedDoc } from './helpers.js';

/**
 * Project Context (SPEC-01) — data access. ALL the SQL for this slice lives
 * here and nowhere else.
 *
 * Constructor takes `Db`, never the container: that is what keeps the
 * `*.it.test.ts` seam real and what keeps a service from reaching
 * `container.db`. Nothing Drizzle-shaped crosses the boundary — no query
 * builder, no `SQL` fragment, no transaction handle appears in any signature
 * below. Rows and plain DTOs only.
 *
 * Tenancy: `agent_context_docs` / `skill_context_docs` carry no `workspace_id`
 * of their own (they are link tables), so every method here reaches the
 * workspace through the owning `agents` / `skills` row. A method that cannot
 * prove the owner belongs to the caller's workspace returns `null` and lets the
 * edge turn that into a 404.
 */

/** The two per-repository fields this feature reads off `repos`. */
export interface RepoContextConfig {
  /** NULL = the repository has no local mirror yet (AC-6's whole signal). */
  clonePath: string | null;
  /** NULL = never configured; the service falls back to DEFAULT_CONTEXT_ROOTS. */
  contextRoots: string[] | null;
}

export interface EffectiveDocRows {
  /** The agent's own attachments, in their stored `order`. */
  direct: OrderedDoc[];
  /**
   * Attachments inherited from the agent's ENABLED skills, already flattened
   * into one sequence ordered by (`agent_skills.order`, `skill_context_docs.order`).
   * `order` here is that sequence position, not a stored column — two skills
   * each holding an `order: 0` document would otherwise interleave.
   */
  inherited: OrderedDoc[];
}

export class ContextRepository {
  constructor(private db: Db) {}

  // ---- repos.context_roots + the mirror -----------------------------------

  /** `null` when the repo does not exist in this workspace. */
  async getRepoForContext(workspaceId: string, repoId: string): Promise<RepoContextConfig | null> {
    const [row] = await this.db
      .select({ clonePath: t.repos.clonePath, contextRoots: t.repos.contextRoots })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return row ?? null;
  }

  async getRoots(workspaceId: string, repoId: string): Promise<string[] | null> {
    const row = await this.getRepoForContext(workspaceId, repoId);
    return row?.contextRoots ?? null;
  }

  /** `false` when the repo does not exist in this workspace (nothing written). */
  async setRoots(workspaceId: string, repoId: string, roots: string[]): Promise<boolean> {
    const updated = await this.db
      .update(t.repos)
      .set({ contextRoots: roots })
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
      .returning({ id: t.repos.id });
    return updated.length > 0;
  }

  // ---- attachment lists ---------------------------------------------------

  async listAgentDocs(agentId: string): Promise<OrderedDoc[]> {
    return this.db
      .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
  }

  async listSkillDocs(skillId: string): Promise<OrderedDoc[]> {
    return this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
  }

  async agentInWorkspace(workspaceId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
    return row !== undefined;
  }

  async skillInWorkspace(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)));
    return row !== undefined;
  }

  /**
   * Replace an agent's whole attachment list, renumbering `order` from the
   * array index (AC-19). Delete-then-insert inside ONE transaction so a
   * half-replaced list is never observable; the transaction handle stays inside
   * this method. Returns `null` when the agent is not in this workspace.
   */
  async replaceAgentDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<OrderedDoc[] | null> {
    if (!(await this.agentInWorkspace(workspaceId, agentId))) return null;
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, order) => ({ agentId, path, order })));
    });
    return this.listAgentDocs(agentId);
  }

  /** The skill-side twin of `replaceAgentDocs`. */
  async replaceSkillDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<OrderedDoc[] | null> {
    if (!(await this.skillInWorkspace(workspaceId, skillId))) return null;
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, order) => ({ skillId, path, order })));
    });
    return this.listSkillDocs(skillId);
  }

  // ---- run-time resolution ------------------------------------------------

  /**
   * Everything one agent could inject: its own attachments plus those of the
   * skills linked to it. `skills.enabled` is the gate (AC-34) — a disabled
   * skill keeps its rows and its position and contributes nothing, exactly like
   * a disabled skill body in the prompt.
   *
   * Two ordered arrays out; the merge, the de-duplication and the cap are
   * `resolveEffectiveDocs` in ring 2.
   */
  async effectiveDocsForAgent(agentId: string): Promise<EffectiveDocRows> {
    const direct = await this.listAgentDocs(agentId);
    const inheritedRows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .innerJoin(t.skillContextDocs, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order), asc(t.skillContextDocs.order));
    return {
      direct,
      inherited: inheritedRows.map((r, order) => ({ path: r.path, order })),
    };
  }

  /**
   * Distinct agents reaching each path, directly or through an ENABLED skill
   * (AC-24). An agent attached both ways counts ONCE — this is a count of
   * agents, never of attachments — which is why the two routes are unioned in
   * a Set rather than summed.
   *
   * Two batched queries over the whole path list, not one query per document.
   */
  async agentReachCounts(workspaceId: string, paths: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (paths.length === 0) return counts;

    const directRows = await this.db
      .select({ path: t.agentContextDocs.path, agentId: t.agentContextDocs.agentId })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agentContextDocs.path, paths)));

    const inheritedRows = await this.db
      .select({ path: t.skillContextDocs.path, agentId: t.agentSkills.agentId })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skills.id, t.skillContextDocs.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.skills.enabled, true),
          inArray(t.skillContextDocs.path, paths),
        ),
      );

    const reach = new Map<string, Set<string>>();
    for (const row of [...directRows, ...inheritedRows]) {
      let set = reach.get(row.path);
      if (!set) {
        set = new Set<string>();
        reach.set(row.path, set);
      }
      set.add(row.agentId);
    }
    for (const [path, agents] of reach) counts.set(path, agents.size);
    return counts;
  }

  /**
   * Paths currently attached anywhere in the workspace — the set whose `missing`
   * flag the listing re-evaluates against the mirror (AC-39).
   */
  async attachedPaths(workspaceId: string): Promise<string[]> {
    const directRows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));
    const skillRows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skills.id, t.skillContextDocs.skillId))
      .where(eq(t.skills.workspaceId, workspaceId));
    return [...new Set([...directRows, ...skillRows].map((r) => r.path))];
  }

  /**
   * Every mirror root in the workspace. An attachment is stored as a bare path
   * with no repository, so "does this document still exist" (AC-39) is asked
   * against all of them — a handful of `stat` calls, not a walk.
   */
  async mirrorRootsForWorkspace(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return rows.map((r) => r.clonePath).filter((p): p is string => p !== null);
  }

  /** The repo a pull request belongs to — the run-time path needs its mirror. */
  async clonePathForRepo(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.clonePath ?? null;
  }
}
