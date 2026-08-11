import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Source labels for a derived intent. LABELS ONLY — never the content itself.
 * That is what makes "no diff bodies and no excess content are recorded"
 * checkable by the type rather than by review.
 */
export const IntentSourceLabel = z.enum([
  'pr_title_body',
  'linked_issue',
  'linked_spec',
  'hunk_headers',
  'commit_messages',
]);
export type IntentSourceLabel = z.infer<typeof IntentSourceLabel>;

/** Deterministic, server-computed confidence tier for a derived intent. */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/**
 * Intent persisted for a PR (the Intent plus the pr_id it scopes), with the
 * derivation metadata L03 added.
 *
 * Every added field is NULLISH, not nullable: rows written before L03 have no
 * value for any of them, and `.nullable()` rejects a MISSING key.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  /** The commit the intent was derived from — what makes staleness decidable. */
  head_sha: z.string().nullish(),
  /**
   * DETERMINISTIC tier, computed server-side from which sources were actually
   * present. This is the number the UI shows.
   */
  confidence: IntentConfidence.nullish(),
  /**
   * The model's own self-rated confidence. STORED, NOT TRUSTED — verbalized LLM
   * confidence is systematically overconfident, and this repo has already
   * measured `findings.confidence` returning 1.0 for a hallucination.
   */
  model_confidence: z.number().min(0).max(1).nullish(),
  sources: z.array(IntentSourceLabel).nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  /** ISO timestamp of the derivation. */
  generated_at: z.string().nullish(),
  /** Derived at READ time: `head_sha` !== the pull's current head_sha. */
  stale: z.boolean().nullish(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/** How much of the answer the persisted index could actually support. */
export const BlastState = z.enum(['full', 'partial', 'degraded']);
export type BlastState = z.infer<typeof BlastState>;

/**
 * WHY the state is not 'full'. A machine code, not prose: the UI maps it to its
 * own i18n string. Absent on the 'full' path.
 */
export const BlastStateReason = z.enum([
  'flag_off',          // REPO_INTEL_ENABLED=false
  'no_index',          // no repo_index_state row for the repo
  'index_failed',      // repo_index_state.status = 'failed' | 'degraded'
  'no_rank_graph',     // status='partial' AND file_rank is empty: the T3 block never ran,
                       // so resolved callers CANNOT be read (INNER JOIN to file_rank)
  'files_not_indexed', // the PR's source files carry no symbols in the index yet
  'index_partial',     // a working but incomplete index
]);
export type BlastStateReason = z.infer<typeof BlastStateReason>;

/**
 * Response of `GET /pulls/:id/blast`.
 *
 * `BlastRadius` itself is NOT extended in place: it is embedded in `PrBrief`,
 * the declared shape of the `pr_brief.json` jsonb column, and every document a
 * later lesson writes there would lack a newly-required key (root `INSIGHTS.md`
 * 2026-08-02). So the transport shape extends it here — `state` is required
 * because the server always computes it, and `reason` is `.nullish()` because it
 * is absent on the 'full' path.
 */
export const BlastRadiusResponse = BlastRadius.extend({
  state: BlastState,
  reason: BlastStateReason.nullish(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;
