import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  // Rollups for the library rail's card footer. LIST endpoint only (same
  // convention as `Agent.skills_count` and `PrMeta.cost_usd`), so they are
  // nullish rather than required counts that would lie as `0` on a single read.
  // `accept_rate` is additionally null when nothing has been judged yet — see
  // SkillStats.
  used_by_count: z.number().int().nullish(),
  pull_rate: z.number().min(0).max(1).nullish(),
  accept_rate: z.number().min(0).max(1).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

/**
 * One immutable snapshot of a skill's body, appended whenever the body changes.
 * `version` matches the `skills.version` that was current when it was written.
 */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  /** Why this version exists. Nullish — an unannotated save has none. */
  message: z.string().nullish(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * Usage and outcome stats for one skill.
 *
 * Two different kinds of number live here, and the difference matters:
 *  - `used_by_count`, `runs_count`, `version_count`, `pull_rate` are
 *    DETERMINISTIC — derived from `agent_skills` and `run_skills`, which the
 *    server wrote itself.
 *  - `accept_rate`, `findings_last_30d` and `findings_by_category` depend on
 *    `findings.skill_id`, which originates in a model-reported field that the
 *    server validated. `unattributed_count` is published alongside them for
 *    exactly that reason: it is the denominator that says how much of the
 *    picture the attribution is missing.
 */
export const SkillStats = z.object({
  used_by_count: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  version_count: z.number().int(),
  /** Runs that injected this skill (from `run_skills`). */
  runs_count: z.number().int(),
  /**
   * Share of the last 30 days' runs by agents currently linking this skill in
   * which it was actually injected. NULL when there were no eligible runs —
   * never 0, which would read as "never pulled" instead of "nothing to measure".
   * Reads 1 for a skill enabled throughout the window, which is correct.
   */
  pull_rate: z.number().min(0).max(1).nullable(),
  /**
   * accepted ÷ (accepted + dismissed) over findings attributed to this skill.
   * NULL until at least one is accepted or dismissed: a skill nobody has judged
   * is not a skill with 0% acceptance. The UI renders null as "—".
   */
  accept_rate: z.number().min(0).max(1).nullable(),
  findings_last_30d: z.number().int(),
  findings_by_category: z.record(z.string(), z.number().int()),
  /** Findings from runs that used this skill which no skill could be attributed to. */
  unattributed_count: z.number().int(),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * What an uploaded file WOULD become, returned by `POST /skills/import` without
 * persisting anything. `ignored_files` lists every archive entry that was NOT
 * read — scripts and assets are surfaced so the user can see what was skipped,
 * and they are never executed nor written to disk.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  ignored_files: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

// ---- Conventions ----

/**
 * Tri-state, not a boolean. A re-scan clears only `pending` rows, so an accepted
 * rule is never re-proposed as a duplicate and a rejected one never comes back.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCategory = z.enum([
  'naming',
  'error-handling',
  'structure',
  'testing',
  'api-shape',
  'tooling',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * One extracted house-rule candidate.
 *
 * Every field except `rule` and `status` is provenance and is NOT editable: the
 * evidence was proven against a file the scan actually read, and the line range
 * was computed from where the snippet was found — never reported by the model.
 * Letting the snippet be rewritten would leave a confidence figure and a line
 * range describing nothing.
 *
 * `confidence` is rendered and NOTHING else — it is not calibrated (the model
 * emits 1.0 for hallucinations just as readily), so it is never sorted, filtered,
 * thresholded or auto-acted on.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  category: ConventionCategory,
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  /** 1-based, inclusive. Server-computed. */
  evidence_line_start: z.number().int(),
  evidence_line_end: z.number().int(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/**
 * One extraction run. `dropped` is how many candidates the model claimed that the
 * evidence gate could not prove — published so a model that systematically
 * invents evidence does not look like one that never does.
 */
export const ConventionScan = z.object({
  id: z.string(),
  files_sampled: z.number().int(),
  candidates: z.number().int(),
  dropped: z.number().int(),
  provider: z.string(),
  model: z.string(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/**
 * `last_scan` is `.nullable()` rather than `.nullish()` because it is rebuilt
 * from columns on every read, so the key is always present. `null` means "never
 * scanned" and the UI omits the subtitle — it must never read as "0 files".
 */
export const ConventionsPayload = z.object({
  candidates: z.array(ConventionCandidate),
  last_scan: ConventionScan.nullable(),
});
export type ConventionsPayload = z.infer<typeof ConventionsPayload>;

/**
 * What the accepted conventions WOULD become, returned by
 * `POST /repos/:id/conventions/skill-draft` without persisting anything — the
 * same contract as `SkillImportPreview`. Everything is editable in the modal
 * before `POST /skills` saves it.
 */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  enabled: z.boolean(),
  evidence_files: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  // How many skills are linked to this agent. LIST endpoint only (like
  // `PrMeta.cost_usd`) — the single-agent read leaves it absent, so it is
  // nullish rather than a required count that would lie as `0`.
  skills_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

/**
 * The same snapshot, as it may actually be found ON DISK.
 *
 * `agent_versions.config_json` is a jsonb document written with whatever shape
 * the agent had at snapshot time, and three of these fields arrived later —
 * `strategy` in migration 0002, `ci_fail_on` in 0003, `repo_intel` in 0007. Any
 * snapshot taken before those is MISSING the keys outright rather than carrying
 * `null`, and `.nullable()` would reject a missing key. `.nullish()` accepts
 * both, which is the rule for every field on a jsonb-persisted contract.
 *
 * Parse stored rows with THIS, then fill the columns' own defaults — see
 * `toAgentVersionDto`. `AgentVersionConfig` above stays strict on purpose: it is
 * the wire contract, and clients should never have to handle a missing strategy.
 */
export const StoredAgentVersionConfig = AgentVersionConfig.extend({
  strategy: ReviewStrategy.nullish(),
  ci_fail_on: CiFailOn.nullish(),
  repo_intel: z.boolean().nullish(),
  // Not tied to a known migration, but written from a separate join
  // (`skillIdsForAgent`) and equally absent from early snapshots.
  skills: z.array(z.string()).nullish(),
});
export type StoredAgentVersionConfig = z.infer<typeof StoredAgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
