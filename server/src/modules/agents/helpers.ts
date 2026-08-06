import type { Agent, AgentVersion, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { StoredAgentVersionConfig } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow } from './repository.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/** Map a persisted agent row to the public `Agent` DTO. */
export function toAgentDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO.
 *
 * `config_json` is untyped jsonb, so it is still validated rather than passed
 * through — but with the LENIENT `StoredAgentVersionConfig`, because snapshots
 * written before migrations 0002/0003/0007 are missing `strategy`, `ci_fail_on`
 * and `repo_intel` entirely. Parsing those with the strict schema threw, and
 * because the caller maps over a list, one old snapshot took the whole version
 * history down with it.
 *
 * The gaps are filled with the columns' OWN defaults, so a replayed old version
 * behaves the way that agent actually behaved at the time.
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  const stored = StoredAgentVersionConfig.parse(row.configJson);
  return {
    agent_id: row.agentId,
    version: row.version,
    config: {
      ...stored,
      strategy: stored.strategy ?? 'single-pass',
      ci_fail_on: stored.ci_fail_on ?? 'critical',
      repo_intel: stored.repo_intel ?? true,
      skills: stored.skills ?? [],
    },
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * `toAgentVersionDto`, but `null` instead of a throw on an unparseable snapshot.
 *
 * For a LIST of versions, one corrupt row should cost that row, not the whole
 * history — a 500 on `GET /agents/:id/versions` hides every good snapshot behind
 * one bad one. Single-version reads keep using the throwing form: there is no
 * partial answer to give, so failing loudly is correct there.
 */
export function toAgentVersionDtoSafe(row: AgentVersionRow): AgentVersion | null {
  try {
    return toAgentVersionDto(row);
  } catch {
    return null;
  }
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}
