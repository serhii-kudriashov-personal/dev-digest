import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillStats, SkillType, SkillSource } from '@devdigest/shared';
import { DEFAULT_SKILL_DESCRIPTION, INITIAL_SKILL_VERSION } from './constants.js';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. The
 * `agent_skills` link table is the AGENTS repository's side of the relation
 * (link/reorder/list for an agent); this one only reads it to answer "which
 * agents use this skill". Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  /**
   * Note recorded against the version this update creates. Ignored unless the
   * body actually changed — a message without a body change would annotate a
   * version that was never written.
   */
  versionMessage?: string;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Delete a skill. `agent_skills` rows cascade, so every agent that used it
   * silently loses one prompt block — the route surfaces that in its response
   * and the UI warns before calling this.
   */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 of its body (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_SKILL_DESCRIPTION,
        type: values.type ?? 'custom',
        source: values.source ?? 'manual',
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION);
    return row!;
  }

  /**
   * Update a skill. A BODY change bumps `version` and appends to
   * `skill_versions`; renames, retypes and the `enabled` toggle do not — the
   * version history tracks the instructions the agent was given, not the
   * metadata around them.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion, patch.versionMessage);
    return row;
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    message?: string | null,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body, message: message ?? null })
      .onConflictDoNothing();
  }

  /**
   * Restore a previous body by APPENDING it as a new version.
   *
   * Never rewinds: `skill_versions` is append-only, and the Versions tab promises
   * that past eval runs stay reproducible against the exact text they scored —
   * moving a pointer backwards would falsify every run that cited the version in
   * between. Restoring v3 while at v5 therefore produces v6 whose body is v3's.
   *
   * Returns undefined when the skill or that version is not in this workspace.
   */
  async restore(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, skillId);
    if (!existing) return undefined;
    const source = await this.getVersion(skillId, version);
    if (!source) return undefined;

    const nextVersion = existing.version + 1;
    const [row] = await this.db
      .update(t.skills)
      .set({ body: source.body, version: nextVersion })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
      .returning();
    if (row) {
      await this.snapshotVersion(row, nextVersion, `Restored from v${version}`);
    }
    return row;
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /** Agents this skill is linked to (read-only view of the agents' link table). */
  async usedByAgents(skillId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));
  }

  // ---- stats ---------------------------------------------------------------

  /**
   * Full stats for one skill. See the `SkillStats` contract for which numbers are
   * deterministic and which depend on validated model attribution.
   */
  async stats(skillId: string): Promise<SkillStats> {
    const agents = await this.usedByAgents(skillId);

    const [versions] = await this.db
      .select({ n: count() })
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId));

    const [runs] = await this.db
      .select({ n: count() })
      .from(t.runSkills)
      .where(eq(t.runSkills.skillId, skillId));

    // Findings ATTRIBUTED to this skill, last 30 days, grouped by category.
    const categories = await this.db
      .select({ category: t.findings.category, n: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(
        and(
          eq(t.findings.skillId, skillId),
          sql`${t.reviews.createdAt} >= now() - interval '30 days'`,
        ),
      )
      .groupBy(t.findings.category);

    const findingsByCategory: Record<string, number> = {};
    let findingsLast30d = 0;
    for (const row of categories) {
      const n = Number(row.n);
      findingsByCategory[row.category] = n;
      findingsLast30d += n;
    }

    // Accept rate over ALL findings attributed to this skill (not windowed — a
    // judgement on an older finding is still a judgement). Undecided findings are
    // excluded from BOTH sides: they are not yet an opinion either way.
    const [judged] = await this.db
      .select({
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`,
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`,
      })
      .from(t.findings)
      .where(eq(t.findings.skillId, skillId));
    const accepted = Number(judged?.accepted ?? 0);
    const dismissed = Number(judged?.dismissed ?? 0);
    const decided = accepted + dismissed;

    // Findings from runs that DID use this skill but which no skill could be
    // attributed to. The honest denominator for everything above it.
    const [unattributed] = await this.db
      .select({ n: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.runSkills, eq(t.runSkills.runId, t.reviews.runId))
      .where(and(eq(t.runSkills.skillId, skillId), isNull(t.findings.skillId)));

    return {
      used_by_count: agents.length,
      agents,
      version_count: Number(versions?.n ?? 0),
      runs_count: Number(runs?.n ?? 0),
      pull_rate: await this.pullRate(skillId),
      // null, never 0 — nothing judged yet is not 0% acceptance.
      accept_rate: decided === 0 ? null : accepted / decided,
      findings_last_30d: findingsLast30d,
      findings_by_category: findingsByCategory,
      unattributed_count: Number(unattributed?.n ?? 0),
    };
  }

  /**
   * Share of the last 30 days' runs by agents currently linking this skill in
   * which the skill was actually injected.
   *
   * Reads 1 for a skill that has been enabled all window — which is correct, not
   * a bug: under this model every enabled linked skill enters every run of its
   * agent. It drops below 1 only when the skill was disabled for part of the
   * window. Null when there were no eligible runs at all.
   */
  private async pullRate(skillId: string): Promise<number | null> {
    const window = sql`now() - interval '30 days'`;
    const [row] = await this.db
      .select({
        eligible: count(),
        pulled: sql<number>`count(${t.runSkills.runId})`,
      })
      .from(t.agentRuns)
      .innerJoin(t.agentSkills, eq(t.agentSkills.agentId, t.agentRuns.agentId))
      .leftJoin(
        t.runSkills,
        and(eq(t.runSkills.runId, t.agentRuns.id), eq(t.runSkills.skillId, skillId)),
      )
      .where(and(eq(t.agentSkills.skillId, skillId), sql`${t.agentRuns.ranAt} >= ${window}`));

    const eligible = Number(row?.eligible ?? 0);
    if (eligible === 0) return null;
    return Number(row?.pulled ?? 0) / eligible;
  }

  /**
   * Card-footer rollups for EVERY skill in the workspace, as a handful of grouped
   * queries joined in memory.
   *
   * The library rail renders these on every card, so the per-skill form would be
   * an N+1 across the whole screen — the same reason `skillCountsByAgent` exists.
   */
  async listRollups(workspaceId: string): Promise<Map<string, SkillRollup>> {
    const usedBy = await this.db
      .select({ skillId: t.agentSkills.skillId, n: count() })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.agentSkills.skillId);

    const judged = await this.db
      .select({
        skillId: t.findings.skillId,
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)`,
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)`,
      })
      .from(t.findings)
      .innerJoin(t.skills, eq(t.skills.id, t.findings.skillId))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.findings.skillId);

    const window = sql`now() - interval '30 days'`;
    const pull = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        eligible: count(),
        pulled: sql<number>`count(${t.runSkills.runId})`,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .innerJoin(t.agentRuns, eq(t.agentRuns.agentId, t.agentSkills.agentId))
      .leftJoin(
        t.runSkills,
        and(
          eq(t.runSkills.runId, t.agentRuns.id),
          eq(t.runSkills.skillId, t.agentSkills.skillId),
        ),
      )
      .where(and(eq(t.skills.workspaceId, workspaceId), sql`${t.agentRuns.ranAt} >= ${window}`))
      .groupBy(t.agentSkills.skillId);

    const out = new Map<string, SkillRollup>();
    const at = (id: string): SkillRollup =>
      out.get(id) ?? { usedByCount: 0, pullRate: null, acceptRate: null };

    for (const r of usedBy) out.set(r.skillId, { ...at(r.skillId), usedByCount: Number(r.n) });
    for (const r of pull) {
      const eligible = Number(r.eligible);
      out.set(r.skillId, {
        ...at(r.skillId),
        pullRate: eligible === 0 ? null : Number(r.pulled) / eligible,
      });
    }
    for (const r of judged) {
      if (!r.skillId) continue;
      const decided = Number(r.accepted) + Number(r.dismissed);
      out.set(r.skillId, {
        ...at(r.skillId),
        acceptRate: decided === 0 ? null : Number(r.accepted) / decided,
      });
    }
    return out;
  }
}

/** Card-footer rollup for one skill. `null` means "nothing to measure yet". */
export interface SkillRollup {
  usedByCount: number;
  pullRate: number | null;
  acceptRate: number | null;
}
