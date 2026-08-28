import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn, Agent } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard (L06, SPEC-04)
// ===========================================================================

/** What an eval case asserts about the fixture: a finding must (not) appear. */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/** One expectation: a file + inclusive line range the case's fixture concerns. */
export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * Where a case came from (AC-6, AC-7). `available: false` covers both "never
 * had provenance" (hand-authored case) and "source since deleted" — the two
 * are otherwise indistinguishable once the source PR is gone.
 */
export const EvalCaseProvenance = z.object({
  available: z.boolean(),
  finding_id: z.string().nullish(),
  pr_id: z.string().nullish(),
  pr_number: z.number().int().nullish(),
  repo_full_name: z.string().nullish(),
  head_sha: z.string().nullish(),
});
export type EvalCaseProvenance = z.infer<typeof EvalCaseProvenance>;

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
  expectation: EvalExpectation.nullish(),
  /** Re-run this case automatically whenever it is saved (AC-14). */
  run_on_save: z.boolean().default(false),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type EvalCaseInputBody = z.input<typeof EvalCaseInput>;

/** A persisted eval case, returned by the API. */
export const EvalCaseRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown().nullish(),
  notes: z.string().nullish(),
  run_on_save: z.boolean(),
  created_at: z.string(),
  expectation: EvalExpectation.nullish(),
  provenance: EvalCaseProvenance.nullish(),
  /** True when the case has no expectation kind yet — presented as needing
   *  repair rather than silently treated as must-find. */
  needs_repair: z.boolean(),
  last_result: z.enum(['pass', 'fail', 'never_run']),
  last_ran_at: z.string().nullish(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

export const EvalRunStatus = z.enum(['running', 'complete', 'incomplete']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * AC-17's run identity: one row per "run this agent's case set", carrying its
 * own denormalised metrics so they survive a case being deleted afterwards
 * (`eval_runs.case_id` cascades; these columns never do — AC-16).
 */
export const EvalSetRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullish(),
  config_version: z.number().int(),
  provider: z.string(),
  model: z.string(),
  covered_case_ids: z.array(z.string()),
  ran_at: z.string(),
  finished_at: z.string().nullable(),
  status: EvalRunStatus,
  incomplete_reason: z.string().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cases_passed: z.number().int(),
  cases_covered: z.number().int(),
  cases_done: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  /** True once per-case detail (`eval_runs` rows) has been pruned by
   *  retention (NFR-8) — the set-run's own metrics remain intact. */
  detail_expired: z.boolean(),
});
export type EvalSetRun = z.infer<typeof EvalSetRun>;

/** A persisted eval run row (one case's execution within a set run), returned
 *  by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  /** The set run this case execution belongs to; null for a single-case run
   *  (AC-32). */
  set_run_id: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Why this case's execution did not complete (parse failure, timeout,
   *  provider error) — set only when the case did not run to a normal result. */
  error: z.string().nullish(),
  /** Findings dropped by the citation-grounding gate during this case's run. */
  grounding_dropped: z.unknown().nullish(),
  /** Whether the expectation was matched by a grounded finding. */
  matched: z.boolean().nullish(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per completed set run, chronological). */
export const EvalTrendPoint = z.object({
  set_run_id: z.string(),
  config_version: z.number().int(),
  ran_at: z.string(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** One agent's row on the cross-agent dashboard (AC-40, AC-41). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  cases_total: z.number().int(),
  never_run: z.boolean(),
  last_run: EvalSetRun.nullable(),
  /** Direction against this agent's previous COMPARABLE run; null when the
   *  last two runs are not comparable (or there is no previous run). */
  direction: z.enum(['up', 'down', 'flat']).nullable(),
  comparable: z.boolean(),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** Aggregate dashboard across every agent with an eval case set. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z
    .object({
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
    })
    .nullish(),
  trend: z.array(EvalTrendPoint),
  /** Cross-agent recent list (AC-42) — SET runs (not per-case detail rows),
   *  newest first, capped at `EVAL_MAX_RECENT_RUNS`. */
  recent_runs: z.array(EvalSetRun),
  /** Per-agent rows (AC-40…AC-44); empty when no agent has a case. */
  agents: z.array(EvalAgentSummary),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

/** Body of `POST /agents/:id/eval-runs` — omit `case_ids` to run the whole set. */
export const EvalRunSetInput = z.object({
  case_ids: z.array(z.string()).nullish(),
});
export type EvalRunSetInput = z.infer<typeof EvalRunSetInput>;

/** Two-run comparison (AC-33…AC-37), with the attributability warning. */
export const EvalComparison = z.object({
  earlier: EvalSetRun,
  later: EvalSetRun,
  metrics: z.array(
    z.object({
      key: z.enum(['recall', 'precision', 'citation_accuracy']),
      earlier: z.number().nullable(),
      later: z.number().nullable(),
      delta: z.number().nullable(),
    }),
  ),
  prompts: z.object({
    earlier: z.string().nullable(),
    later: z.string().nullable(),
  }),
  attributability: z.object({
    case_set_changed: z.boolean(),
    model_changed: z.boolean(),
    attributable: z.boolean(),
  }),
  /** True when either side's per-case detail has been pruned (NFR-8). */
  detail_expired: z.boolean(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

/** Response of `POST /agents/:id/versions/:version/promote` (AC-38, AC-39). */
export const EvalPromoteResult = z.object({
  agent: Agent,
  /** False when the promoted config already equalled the live one (A10) — no
   *  new version was created. */
  promoted: z.boolean(),
  version: z.number().int(),
});
export type EvalPromoteResult = z.infer<typeof EvalPromoteResult>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  repo: z.string().nullish(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
