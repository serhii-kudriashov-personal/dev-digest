import type { Finding, Severity } from '@devdigest/shared';

/**
 * Scope gate — the deterministic noise filter for out-of-scope findings.
 *
 * A sibling of `grounding.ts`, deliberately the same shape: a pure function
 * over findings that returns what survived plus what was dropped and why. Both
 * are gates rather than code — the non-LLM half of the review, the half that
 * cannot be talked out of its answer.
 *
 * Why deterministic and not a prompt instruction: this repo has MEASURED that
 * stacking rules into an agent's system prompt makes reviews worse (a run lost
 * a real SSRF finding and invented a false one). `Finding.scope` asks the model
 * only to LABEL; the decision of what to suppress is made here, in code, where
 * it is testable and cannot be argued with.
 *
 * The bound that makes this safe, and the reason the gate can never be turned
 * into a silencer: EVERY out-of-scope CRITICAL survives, unconditionally. A PR
 * body claiming "this only touches docs" can therefore reduce noise, but can
 * never reduce a real defect to silence.
 */

export interface ScopeResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** Highest first. Ties are broken by input order, never by re-sorting. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/**
 * Apply the scope gate.
 *
 * @param findings the findings that survived grounding, in their input order
 * @param hasIntent whether an intent block was actually put in the prompt. When
 *        false the gate is a provable NO-OP: the very same array comes back.
 *
 * Rules, in order:
 *  1. no intent  → identity, nothing dropped;
 *  2. keep every finding not labelled exactly `out_of_scope`
 *     (`null` / `undefined` / `in_scope` all pass);
 *  3. keep EVERY out-of-scope CRITICAL, unconditionally — the escape hatch;
 *  4. of the remaining out-of-scope findings keep AT MOST ONE — the highest
 *     severity, ties broken by input order — so a genuine signal always
 *     survives while the noise collapses;
 *  5. never reorder the kept findings relative to their input order.
 */
export function applyScopeGate(findings: Finding[], hasIntent: boolean): ScopeResult {
  // Identity, not a copy-with-filter: "no intent means no behaviour change"
  // should be provable by reference, not merely by deep equality.
  if (!hasIntent) return { kept: findings, dropped: [] };

  const outOfScopeNonCritical: Finding[] = [];
  for (const f of findings) {
    if (f.scope === 'out_of_scope' && f.severity !== 'CRITICAL') outOfScopeNonCritical.push(f);
  }

  // The single survivor among the non-critical out-of-scope findings.
  let survivor: Finding | null = null;
  for (const f of outOfScopeNonCritical) {
    if (survivor === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[survivor.severity]) {
      survivor = f;
    }
  }
  const droppedCount = Math.max(outOfScopeNonCritical.length - 1, 0);

  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];
  for (const f of findings) {
    if (f.scope !== 'out_of_scope' || f.severity === 'CRITICAL' || f === survivor) {
      kept.push(f);
      continue;
    }
    dropped.push({
      finding: f,
      reason: `out of the PR's stated scope (${droppedCount} similar dropped)`,
    });
  }

  return { kept, dropped };
}

/** Human-readable summary, mirroring `groundingSummary`. */
export function scopeSummary(result: ScopeResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} in scope`;
}
