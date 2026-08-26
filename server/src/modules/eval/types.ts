import type { EvalExpectationKind } from '@devdigest/shared';

/**
 * Eval slice public facade types (L06, SPEC-04) — no I/O, no Drizzle. This
 * file, along with `constants.ts`, is the slice's public surface
 * (`backend-onion-architecture` §13): another slice may import these.
 */

/** One case's contribution to a set run's arithmetic scoring (`helpers.ts#scoreRun`). */
export interface EvalCaseScoreInput {
  /** False when the case failed to execute (parse failure, timeout, cancelled,
   *  provider error) — it then contributes to no denominator at all. */
  executed: boolean;
  /** Null for a case that still `needs_repair` (no expectation kind recorded). */
  expectationKind: EvalExpectationKind | null;
  /** Whether a grounded finding satisfied this case's own expectation location
   *  (same file, overlapping range) — see `helpers.ts#matchExpectation`.
   *  Meaningless (and ignored) when `expectationKind` is null. */
  matched: boolean;
  /** Grounded findings produced while executing this case. */
  groundedCount: number;
  /** Findings dropped by the citation-grounding gate while executing this case. */
  droppedCount: number;
}

/** One case's identity + outcome, as needed by `helpers.ts#derivedNote` to
 *  compare two runs without re-deriving anything from raw findings. */
export interface EvalCaseComparisonEntry {
  caseId: string;
  caseName: string;
  pass: boolean | null;
  /** Identity of the finding this case's run matched (`file:start-end`), or
   *  null when no finding matched. Used only to detect "present in one run,
   *  absent in the other" (AC-43) — never rendered verbatim. */
  findingKey: string | null;
}
