import type { Skill, SkillImportPreview, SkillStats, SkillVersion } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SkillsRepository } from './repository.js';
import type { InsertSkill, UpdateSkill } from './repository.js';
import { parseSkillUpload, toSkillDto, toSkillVersionDto } from './helpers.js';

/**
 * A1 — skills service.
 *
 * A Skill is a reusable instruction block: name + directive description + type +
 * markdown body. Agents link to skills in an explicit order (the agents module
 * owns that link), and `assemblePrompt` renders the enabled ones as the
 * `## Skills / rules` section of the review prompt.
 */

export type CreateSkillInput = Omit<InsertSkill, 'workspaceId'>;
export type UpdateSkillInput = UpdateSkill;

/** What a skill created from an uploaded file looks like before it is vetted. */
export interface UsedByAgent {
  id: string;
  name: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = container.skillsRepo;
  }

  /**
   * The library, each skill carrying its card-footer rollups. The rollups are
   * LIST-only (see the `Skill` contract) and come from grouped queries, never one
   * lookup per card.
   */
  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const rollups = await this.repo.listRollups(workspaceId);
    return rows.map((row) => {
      const r = rollups.get(row.id);
      return {
        ...toSkillDto(row),
        used_by_count: r?.usedByCount ?? 0,
        pull_rate: r?.pullRate ?? null,
        accept_rate: r?.acceptRate ?? null,
      };
    });
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({ workspaceId, ...input });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history for a skill, newest version first. Returns undefined when the
   * skill is not in this workspace (the route maps that to a 404) — an empty
   * array would claim the skill exists and has no history.
   */
  async listVersions(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** Which agents currently link this skill. Undefined when not in the workspace. */
  async usedBy(workspaceId: string, skillId: string): Promise<UsedByAgent[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.usedByAgents(skillId);
  }

  /** Usage and outcome stats. Undefined when the skill is not in this workspace. */
  async stats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.stats(skillId);
  }

  /**
   * Restore a previous body. APPENDS a new version rather than rewinding — see
   * the repository for why. Undefined when the skill or that version is absent.
   */
  async restore(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const row = await this.repo.restore(workspaceId, skillId, version);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Parse an upload and return what it WOULD become — persisting nothing.
   *
   * The preview is the whole point: importing a skill hands a stranger's text to
   * your agent as instructions, so the user sees the extracted body and the list
   * of skipped files BEFORE anything is stored. Executable entries in an archive
   * are never run and never written to disk; they are only reported.
   */
  importPreview(filename: string, contentBase64: string): SkillImportPreview {
    return parseSkillUpload(filename, Buffer.from(contentBase64, 'base64'));
  }
}
