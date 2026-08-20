import type {
  EvalCaseProvenance,
  EvalCaseRecord,
  EvalComparison,
  EvalExpectation,
  EvalExpectationKind,
  EvalOwnerKind,
  EvalRunRecord,
  EvalRunStatus,
  EvalSetRun,
  EvalTrendPoint,
  Finding,
} from '@devdigest/shared';
import { SECRET_PATTERNS } from '../brief/constants.js';
import { EVAL_MAX_TREND_POINTS } from './constants.js';
import type { EvalCaseComparisonEntry, EvalCaseScoreInput } from './types.js';
// Row types only (type-only import, erased at compile — no runtime edge to
// `repository.ts`, same precedent as `agents/helpers.ts` importing `AgentRow`).
import type { EvalCaseRow, EvalRunRow, EvalSetRunRow, LatestCaseResult } from './repository.js';

/**
 * Eval slice pure transforms (L06, SPEC-04) — zero I/O, no `Db`, no
 * `Container`, no `fastify`. Everything here is arithmetic or string shaping
 * over already-resolved data (`backend-onion-architecture` §1, §8).
 */

export interface LineRange {
  start_line: number;
  end_line: number;
}

/** Inclusive line-range overlap. AC-19: 10–14 is satisfied by 12–18, not by
 *  20–24 — callers are responsible for the "same file" check (this is a pure
 *  number comparison, no file identity here). */
export function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

/** A case's `input_meta` is `z.unknown()` — pull out the PR body it may carry
 *  (for `reviewPullRequest`'s `prDescription` slot) without trusting its shape. */
export function prDescriptionFromMeta(inputMeta: unknown): string | undefined {
  if (inputMeta && typeof inputMeta === 'object' && 'body' in inputMeta) {
    const v = (inputMeta as Record<string, unknown>).body;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** An eval-run's injected skill, resolved to a body (not a slug). */
export interface EvalInjectedSkill {
  name: string;
  body: string;
}

/**
 * Render the `## Skills / rules` section's blocks, labelled with their name —
 * BYTE-IDENTICAL to `modules/reviews/helpers.ts#labelSkillBodies`, duplicated
 * rather than imported: `reviews/helpers.ts` is private to the reviews slice
 * (`no-cross-slice-import`), and an eval run must reproduce the same prompt
 * shape a real review would get for the same agent.
 */
export function labelSkillBodies(skills: EvalInjectedSkill[]): string[] {
  return skills.map((s) => `### ${s.name}\n${s.body}`);
}

/**
 * The first grounded finding with the same file and an overlapping range, or
 * `undefined`. Case-sensitive EXACT path equality — deliberately not
 * `smart-diff/helpers.ts#normalizePath` (that would be a cross-slice import,
 * blocked by `no-cross-slice-import`), and not re-derived either: the fixture
 * and the produced finding both come from the SAME frozen diff, so the paths
 * are already byte-identical and normalisation would add nothing.
 */
export function matchExpectation(
  expectation: EvalExpectation,
  findings: Finding[],
): Finding | undefined {
  return findings.find((f) => f.file === expectation.file && overlaps(expectation, f));
}

/** AC-24: must_find passes when matched; must_not_flag passes when NOT
 *  matched. A case with no expectation kind (`needs_repair`) never passes. */
export function caseOutcome(expectationKind: EvalExpectationKind | null, matched: boolean): boolean {
  if (expectationKind === 'must_find') return matched;
  if (expectationKind === 'must_not_flag') return !matched;
  return false;
}

export interface RunScore {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesPassed: number;
}

/**
 * Arithmetic-only run scoring (AC-18, AC-20…AC-24). A case that failed to
 * execute (`executed: false`) contributes to NO denominator anywhere.
 *
 * Precision has one deliberate exception to the "no denominator → null" rule
 * (AC-23's own verification, cross-referenced against spec §Edge cases rows
 * "A set holds only must-not-flag cases" / "A set holds only must-find
 * cases"): when zero findings were produced AND the run contains at least one
 * must-find case, precision is UNKNOWN (there was an unmet opportunity to
 * produce a correct finding). When zero findings were produced and the run
 * holds ONLY must-not-flag cases, precision is REPORTED as 1 — a run that
 * correctly withheld every forbidden finding has no incorrect output to
 * divide by, which is a definite (not unknown) result. Recall and citation
 * accuracy have no such exception: both are `null` whenever their own
 * denominator is 0.
 */
export function scoreRun(perCase: EvalCaseScoreInput[]): RunScore {
  const executed = perCase.filter((c) => c.executed);

  const mustFind = executed.filter((c) => c.expectationKind === 'must_find');
  const recall = mustFind.length === 0 ? null : mustFind.filter((c) => c.matched).length / mustFind.length;

  const totalProduced = executed.reduce((n, c) => n + c.groundedCount, 0);
  const matchedProduced = executed.reduce(
    (n, c) => n + (c.expectationKind === 'must_find' && c.matched ? 1 : 0),
    0,
  );
  const precision =
    totalProduced === 0 ? (mustFind.length > 0 ? null : 1) : matchedProduced / totalProduced;

  const totalDropped = executed.reduce((n, c) => n + c.droppedCount, 0);
  const citationAccuracy =
    totalProduced + totalDropped === 0 ? null : totalProduced / (totalProduced + totalDropped);

  const casesPassed = executed.filter((c) => caseOutcome(c.expectationKind, c.matched)).length;

  return { recall, precision, citationAccuracy, casesPassed };
}

/** AC-31, NFR-4: `null` only when EVERY call reported `null`; otherwise the
 *  sum of the ones that ARE known (unknown cost is never coerced to 0). */
export function sumCost(costs: (number | null)[]): number | null {
  const known = costs.filter((c): c is number => c !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, c) => sum + c, 0);
}

/**
 * Freeze a single-file unified-diff fragment from a stored patch (AC-5).
 *
 * Shape copied from `modules/reviews/diff-loader.ts#diffFromPrFiles`,
 * duplicated rather than imported: that function takes a `ReviewRepository`
 * and reconstructs EVERY file in a PR, where this needs exactly one frozen
 * file. `modules/_shared/pr-text.ts` is the promotion target if a third
 * consumer needs this shape (`server/INSIGHTS.md` 2026-08-17).
 */
export function singleFileDiffFragment(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}

/** AC-2, AC-3: an accepted finding freezes a must-find expectation; a
 *  dismissed one freezes a must-not-flag expectation. */
export function expectationFromFinding(input: {
  file: string;
  startLine: number;
  endLine: number;
  judgement: 'accepted' | 'dismissed';
}): EvalExpectation {
  return {
    kind: input.judgement === 'accepted' ? 'must_find' : 'must_not_flag',
    file: input.file,
    start_line: input.startLine,
    end_line: input.endLine,
  };
}

/**
 * AC-9: whether a fixture retains a secret-shaped literal. Reuses
 * `brief/constants.ts#SECRET_PATTERNS` (a slice `constants.ts` is a
 * sanctioned cross-slice import) — NEVER `brief/helpers.ts#redactSecrets`,
 * which is the wrong behaviour here: AC-9 warns and RETAINS, it never
 * redacts.
 *
 * Every pattern carries the `/g` flag, so `RegExp.prototype.test` mutates
 * `lastIndex` — a second call on the SAME input can otherwise return `false`
 * even though the first call returned `true`. Reset `lastIndex` before every
 * test to keep this function callable more than once per pattern.
 */
export function hasSecretShapedLiteral(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const found = pattern.test(text);
    pattern.lastIndex = 0;
    if (found) return true;
  }
  return false;
}

function sameCaseSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

/** Two-run comparison (AC-33…AC-37) with the attributability warning. */
export function comparisonOf(
  earlier: EvalSetRun,
  later: EvalSetRun,
  promptEarlier: string | null,
  promptLater: string | null,
): EvalComparison {
  const caseSetChanged = !sameCaseSet(earlier.covered_case_ids, later.covered_case_ids);
  const modelChanged = earlier.model !== later.model;
  const metrics = (['recall', 'precision', 'citation_accuracy'] as const).map((key) => {
    const e = earlier[key];
    const l = later[key];
    return { key, earlier: e, later: l, delta: e === null || l === null ? null : l - e };
  });
  return {
    earlier,
    later,
    metrics,
    prompts: { earlier: promptEarlier, later: promptLater },
    attributability: {
      case_set_changed: caseSetChanged,
      model_changed: modelChanged,
      attributable: !caseSetChanged && !modelChanged,
    },
    detail_expired: earlier.detail_expired || later.detail_expired,
  };
}

/**
 * AC-43's prose note. Generated from exactly THREE sources — a metric that
 * moved, a case whose outcome flipped, or a finding present in one run and
 * absent in the other — so the "no unfounded claims" constraint is structural
 * rather than a matter of wording care (plan R8). Returns `null` when none of
 * the three apply.
 */
export function derivedNote(
  metrics: EvalComparison['metrics'],
  earlierPerCase: EvalCaseComparisonEntry[],
  laterPerCase: EvalCaseComparisonEntry[],
): string | null {
  const notes: string[] = [];

  for (const m of metrics) {
    if (m.delta !== null && m.delta !== 0) {
      const direction = m.delta > 0 ? 'improved' : 'declined';
      notes.push(`${m.key} ${direction} by ${Math.abs(m.delta).toFixed(2)}`);
    }
  }

  const earlierByCase = new Map(earlierPerCase.map((c) => [c.caseId, c]));
  for (const later of laterPerCase) {
    const before = earlierByCase.get(later.caseId);
    if (before && before.pass !== later.pass) {
      notes.push(`"${later.caseName}" now ${later.pass ? 'passes' : 'fails'}`);
    }
  }

  const earlierFindingKeys = new Set(
    earlierPerCase.map((c) => c.findingKey).filter((k): k is string => k !== null),
  );
  const laterFindingKeys = new Set(
    laterPerCase.map((c) => c.findingKey).filter((k): k is string => k !== null),
  );
  const onlyInEarlier = [...earlierFindingKeys].some((k) => !laterFindingKeys.has(k));
  const onlyInLater = [...laterFindingKeys].some((k) => !earlierFindingKeys.has(k));
  if (onlyInEarlier || onlyInLater) {
    notes.push('a finding present in one run is absent in the other');
  }

  return notes.length === 0 ? null : notes.join('; ');
}

/** Complete runs only, newest-last, capped at `EVAL_MAX_TREND_POINTS` (AC-26,
 *  NFR-3). Expects `setRuns` newest-first (as `EvalRepository#listSetRuns`
 *  returns them). */
export function trendPoints(setRunsNewestFirst: EvalSetRun[]): EvalTrendPoint[] {
  const complete = setRunsNewestFirst.filter((r) => r.status === 'complete');
  return complete
    .slice(0, EVAL_MAX_TREND_POINTS)
    .reverse()
    .map((r) => ({
      set_run_id: r.id,
      config_version: r.config_version,
      ran_at: r.ran_at,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citation_accuracy,
      pass_rate: r.cases_covered === 0 ? null : r.cases_passed / r.cases_covered,
      cost_usd: r.cost_usd,
    }));
}

// ===========================================================================
// Row → DTO mapping (pure; same precedent as `agents/helpers.ts#toAgentDto`)
// ===========================================================================

/** A case row's expectation, or `undefined` when it has none yet
 *  (`needs_repair`). */
export function caseExpectation(row: EvalCaseRow): EvalExpectation | undefined {
  if (
    row.expectationKind === null ||
    row.expectFile === null ||
    row.expectStartLine === null ||
    row.expectEndLine === null
  ) {
    return undefined;
  }
  return {
    kind: row.expectationKind as EvalExpectationKind,
    file: row.expectFile,
    start_line: row.expectStartLine,
    end_line: row.expectEndLine,
  };
}

/** AC-6, AC-7: `available` is a caller-supplied fact (a live re-check of the
 *  source PR/finding), never derived from the presence of the stored ids —
 *  those columns are FK-less and survive the source's deletion by design. */
export function toEvalCaseProvenance(row: EvalCaseRow, available: boolean): EvalCaseProvenance {
  return {
    available,
    finding_id: row.sourceFindingId,
    pr_id: row.sourcePrId,
    pr_number: row.sourcePrNumber,
    repo_full_name: row.sourceRepoFullName,
    head_sha: row.sourceHeadSha,
  };
}

export function toEvalCaseRecord(
  row: EvalCaseRow,
  latest: LatestCaseResult | undefined,
  provenanceAvailable: boolean,
): EvalCaseRecord {
  const expectation = caseExpectation(row);
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
    run_on_save: row.runOnSave,
    created_at: row.createdAt.toISOString(),
    expectation,
    provenance: toEvalCaseProvenance(row, provenanceAvailable),
    needs_repair: expectation === undefined,
    last_result: latest === undefined ? 'never_run' : latest.pass === true ? 'pass' : latest.pass === false ? 'fail' : 'never_run',
    last_ran_at: latest?.ranAt.toISOString() ?? null,
  };
}

export function toEvalSetRunDto(row: EvalSetRunRow, agentName: string | null): EvalSetRun {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_name: agentName,
    config_version: row.configVersion,
    provider: row.provider,
    model: row.model,
    covered_case_ids: row.coveredCaseIds,
    ran_at: row.ranAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as EvalRunStatus,
    incomplete_reason: row.incompleteReason,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cases_passed: row.casesPassed,
    cases_covered: row.casesCovered,
    cases_done: row.casesDone,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    detail_expired: row.detailPruned,
  };
}

export function toEvalRunRecordDto(row: EvalRunRow, caseName: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName,
    set_run_id: row.setRunId,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    error: row.error,
    grounding_dropped: row.groundingDropped,
    matched: row.matched,
  };
}
