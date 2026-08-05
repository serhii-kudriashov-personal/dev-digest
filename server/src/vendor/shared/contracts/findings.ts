import { z } from 'zod';

/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

/**
 * A tally of findings per severity. One definition for every aggregate that
 * reports a breakdown — the PR list column, `AgentStats`, `AgentPerfRow`, and
 * the server-side `rollupSeverities` helper. Keys match the `Severity` enum.
 * See specs/findings-by-severity.md.
 */
export const SeverityCounts = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  'finding',
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

export const TrifectaComponent = z.enum([
  'private_data_access',
  'untrusted_input',
  'exfil_path',
]);
export type TrifectaComponent = z.infer<typeof TrifectaComponent>;

export const TrifectaEvidence = z.object({
  component: TrifectaComponent,
  file: z.string(),
  line: z.number().int(),
});
export type TrifectaEvidence = z.infer<typeof TrifectaEvidence>;

/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 */
export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  kind: FindingKind.nullish(),
  // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
  trifecta_components: z.array(TrifectaComponent).nullish(),
  evidence: z.array(TrifectaEvidence).nullish(),
  /**
   * Skill attribution. This schema IS the LLM's structured-output contract
   * (`reviewer-core` passes `Review` straight to `completeStructured`), so the
   * `.describe()` below is the instruction the model actually reads — which is
   * why the attribution needs no change to `prompt.ts` or `INJECTION_GUARD`.
   *
   * NULLISH, not nullable: `Finding` is embedded in `eval_cases.expected_output`
   * and `eval_runs.actual_output`, both jsonb, where a missing key must parse.
   *
   * The value is UNVERIFIED on arrival. The server keeps it only when the slug
   * names a skill that was really injected into that run, and stores NULL
   * otherwise — see `resolveSkillAttribution`.
   */
  skill: z
    .string()
    .nullish()
    .describe(
      'The exact slug of the skill from the "## Skills / rules" section whose rule ' +
        'this finding applies, copied verbatim. Set null when the finding came from ' +
        'your own analysis rather than one of those listed skills. Never guess and ' +
        'never invent a slug — an unrecognised value is discarded.',
    ),
});
export type Finding = z.infer<typeof Finding>;

/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.',
    ),
  findings: z.array(Finding),
});
export type Review = z.infer<typeof Review>;

/** Action taken on a finding (accept/dismiss/learn/reply). */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply']);
export type FindingActionKind = z.infer<typeof FindingActionKind>;

export const FindingAction = z.object({
  action: FindingActionKind,
  reply: z.string().optional(),
});
export type FindingAction = z.infer<typeof FindingAction>;
