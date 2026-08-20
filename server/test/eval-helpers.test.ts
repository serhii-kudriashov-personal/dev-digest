import { describe, it, expect } from 'vitest';
import type { EvalSetRun } from '@devdigest/shared';
import {
  overlaps,
  matchExpectation,
  caseOutcome,
  scoreRun,
  sumCost,
  singleFileDiffFragment,
  expectationFromFinding,
  hasSecretShapedLiteral,
  comparisonOf,
  derivedNote,
  trendPoints,
} from '../src/modules/eval/helpers.js';
import { EVAL_MAX_TREND_POINTS } from '../src/modules/eval/constants.js';
import type { EvalCaseScoreInput, EvalCaseComparisonEntry } from '../src/modules/eval/types.js';

/**
 * Eval slice pure transforms (L06, SPEC-04) — hermetic: no container, no
 * Docker, no key, no network. Covers the arithmetic-only scoring rules
 * (AC-19…AC-24, AC-31), the two-run comparison (AC-35, AC-36), the derived
 * note (AC-43) and the `/g`-flag `lastIndex` trap on `hasSecretShapedLiteral`
 * (AC-9, `server/INSIGHTS.md` — plan R9).
 */

function setRun(overrides: Partial<EvalSetRun> = {}): EvalSetRun {
  return {
    id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Reviewer',
    config_version: 1,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    covered_case_ids: ['case-1', 'case-2'],
    ran_at: '2026-08-01T00:00:00.000Z',
    finished_at: '2026-08-01T00:01:00.000Z',
    status: 'complete',
    incomplete_reason: null,
    recall: 0.5,
    precision: 1,
    citation_accuracy: 1,
    cases_passed: 1,
    cases_covered: 2,
    cases_done: 2,
    cost_usd: 0.01,
    duration_ms: 1000,
    detail_expired: false,
    ...overrides,
  };
}

describe('overlaps / matchExpectation (AC-19)', () => {
  it('an expectation on 10-14 is satisfied by a finding on 12-18, same file', () => {
    expect(overlaps({ start_line: 10, end_line: 14 }, { start_line: 12, end_line: 18 })).toBe(true);
  });

  it('is NOT satisfied by a finding on 20-24', () => {
    expect(overlaps({ start_line: 10, end_line: 14 }, { start_line: 20, end_line: 24 })).toBe(false);
  });

  it('matchExpectation requires the SAME file, even with an overlapping range', () => {
    const expectation = { kind: 'must_find' as const, file: 'a.ts', start_line: 10, end_line: 14 };
    const findings = [
      {
        id: 'f1',
        severity: 'WARNING' as const,
        category: 'bug' as const,
        title: 't',
        file: 'b.ts',
        start_line: 12,
        end_line: 18,
        rationale: 'r',
      },
    ];
    expect(matchExpectation(expectation, findings)).toBeUndefined();
  });

  it('matches when file and range both align', () => {
    const expectation = { kind: 'must_find' as const, file: 'a.ts', start_line: 10, end_line: 14 };
    const findings = [
      {
        id: 'f1',
        severity: 'WARNING' as const,
        category: 'bug' as const,
        title: 't',
        file: 'a.ts',
        start_line: 12,
        end_line: 18,
        rationale: 'r',
      },
    ];
    expect(matchExpectation(expectation, findings)?.id).toBe('f1');
  });
});

describe('caseOutcome (AC-24)', () => {
  it('must_find passes when matched, fails when not', () => {
    expect(caseOutcome('must_find', true)).toBe(true);
    expect(caseOutcome('must_find', false)).toBe(false);
  });

  it('must_not_flag passes when NOT matched, fails when matched', () => {
    expect(caseOutcome('must_not_flag', false)).toBe(true);
    expect(caseOutcome('must_not_flag', true)).toBe(false);
  });

  it('a case with no expectation kind never passes', () => {
    expect(caseOutcome(null, true)).toBe(false);
    expect(caseOutcome(null, false)).toBe(false);
  });
});

describe('scoreRun (AC-20…AC-24)', () => {
  it('AC-20: two must-find cases, one found → recall one half', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_find', matched: true, groundedCount: 1, droppedCount: 0 },
      { executed: true, expectationKind: 'must_find', matched: false, groundedCount: 0, droppedCount: 0 },
    ];
    expect(scoreRun(perCase).recall).toBe(0.5);
  });

  it('AC-21: a must-not-flag case that produced the forbidden finding → precision 0', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_not_flag', matched: true, groundedCount: 1, droppedCount: 0 },
    ];
    expect(scoreRun(perCase).precision).toBe(0);
  });

  it('AC-22: citation accuracy is kept/(kept+dropped) over the whole run', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_find', matched: true, groundedCount: 1, droppedCount: 1 },
    ];
    const score = scoreRun(perCase);
    expect(score.citationAccuracy).toBeLessThan(1);
    expect(score.citationAccuracy).toBe(0.5);
  });

  it('AC-23: a must-not-flag-only run that correctly produced nothing → recall and citation accuracy unknown, precision reported', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_not_flag', matched: false, groundedCount: 0, droppedCount: 0 },
      { executed: true, expectationKind: 'must_not_flag', matched: false, groundedCount: 0, droppedCount: 0 },
    ];
    const score = scoreRun(perCase);
    expect(score.recall).toBeNull();
    expect(score.citationAccuracy).toBeNull();
    expect(score.precision).not.toBeNull();
    expect(score.precision).toBe(1);
  });

  it('a must-find-only run that produced nothing → precision unknown (not 1)', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_find', matched: false, groundedCount: 0, droppedCount: 0 },
    ];
    expect(scoreRun(perCase).precision).toBeNull();
  });

  it('AC-24: casesPassed agrees with the per-case pass rule on a mixed set', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: true, expectationKind: 'must_find', matched: true, groundedCount: 1, droppedCount: 0 },
      { executed: true, expectationKind: 'must_not_flag', matched: false, groundedCount: 0, droppedCount: 0 },
      { executed: true, expectationKind: 'must_not_flag', matched: true, groundedCount: 1, droppedCount: 0 },
    ];
    expect(scoreRun(perCase).casesPassed).toBe(2);
  });

  it('a case that failed to execute contributes to no denominator', () => {
    const perCase: EvalCaseScoreInput[] = [
      { executed: false, expectationKind: null, matched: false, groundedCount: 0, droppedCount: 0 },
      { executed: true, expectationKind: 'must_find', matched: true, groundedCount: 1, droppedCount: 0 },
    ];
    const score = scoreRun(perCase);
    expect(score.recall).toBe(1);
    expect(score.casesPassed).toBe(1);
  });
});

describe('sumCost (AC-31, NFR-4)', () => {
  it('is null only when EVERY call reported null', () => {
    expect(sumCost([null, null])).toBeNull();
  });

  it('sums the known ones, never coercing an unknown to 0', () => {
    expect(sumCost([0.01, null, 0.02])).toBeCloseTo(0.03);
  });
});

describe('singleFileDiffFragment', () => {
  it('shapes a single-file unified diff', () => {
    const fragment = singleFileDiffFragment('a.ts', '@@ -1,1 +1,1 @@\n-old\n+new');
    expect(fragment).toContain('diff --git a/a.ts b/a.ts');
    expect(fragment).toContain('--- a/a.ts');
    expect(fragment).toContain('+++ b/a.ts');
  });
});

describe('expectationFromFinding (AC-2, AC-3)', () => {
  it('an accepted finding freezes a must-find expectation', () => {
    const e = expectationFromFinding({
      file: 'a.ts',
      startLine: 10,
      endLine: 14,
      judgement: 'accepted',
    });
    expect(e).toEqual({ kind: 'must_find', file: 'a.ts', start_line: 10, end_line: 14 });
  });

  it('a dismissed finding freezes a must-not-flag expectation', () => {
    const e = expectationFromFinding({
      file: 'a.ts',
      startLine: 10,
      endLine: 14,
      judgement: 'dismissed',
    });
    expect(e.kind).toBe('must_not_flag');
  });
});

describe('hasSecretShapedLiteral (AC-9)', () => {
  it('is true on an sk_live-shaped literal', () => {
    const text = 'api_key: "sk_live_51H8xJ2eZvKYlo2C0X9f"';
    expect(hasSecretShapedLiteral(text)).toBe(true);
  });

  it('is false on ordinary text', () => {
    expect(hasSecretShapedLiteral('just a normal comment about caching')).toBe(false);
  });

  it('is STILL true on a second call with the SAME input — the /g lastIndex trap', () => {
    const text = 'api_key: "sk_live_51H8xJ2eZvKYlo2C0X9f"';
    expect(hasSecretShapedLiteral(text)).toBe(true);
    expect(hasSecretShapedLiteral(text)).toBe(true);
    expect(hasSecretShapedLiteral(text)).toBe(true);
  });
});

describe('comparisonOf (AC-35, AC-36, AC-37)', () => {
  it('flags a case-set change and a model change, and reports non-attributable', () => {
    const earlier = setRun({
      covered_case_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'],
      model: 'model-a',
      recall: 0.5,
    });
    const later = setRun({
      covered_case_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
      model: 'model-b',
      recall: 0.8,
    });
    const cmp = comparisonOf(earlier, later, 'prompt A', 'prompt B');
    expect(cmp.attributability.case_set_changed).toBe(true);
    expect(cmp.attributability.model_changed).toBe(true);
    expect(cmp.attributability.attributable).toBe(false);
  });

  it('AC-37: the same case set and model twice reports non-null deltas', () => {
    const earlier = setRun({ recall: 0.5, precision: 0.6, citation_accuracy: 0.7 });
    const later = setRun({ recall: 0.8, precision: 0.6, citation_accuracy: 0.9 });
    const cmp = comparisonOf(earlier, later, null, null);
    expect(cmp.attributability.attributable).toBe(true);
    const recallMetric = cmp.metrics.find((m) => m.key === 'recall')!;
    expect(recallMetric.delta).toBeCloseTo(0.3);
  });
});

describe('derivedNote (AC-43)', () => {
  const metricsUnchanged = [
    { key: 'recall' as const, earlier: 0.5, later: 0.5, delta: 0 },
    { key: 'precision' as const, earlier: 1, later: 1, delta: 0 },
    { key: 'citation_accuracy' as const, earlier: 1, later: 1, delta: 0 },
  ];

  it('is null when nothing differs between the two runs', () => {
    const earlierPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: true, findingKey: 'a.ts:1-2' },
    ];
    const laterPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: true, findingKey: 'a.ts:1-2' },
    ];
    expect(derivedNote(metricsUnchanged, earlierPerCase, laterPerCase)).toBeNull();
  });

  it('names a metric that moved', () => {
    const metrics = [
      { key: 'recall' as const, earlier: 0.5, later: 0.8, delta: 0.3 },
      { key: 'precision' as const, earlier: 1, later: 1, delta: 0 },
      { key: 'citation_accuracy' as const, earlier: 1, later: 1, delta: 0 },
    ];
    const note = derivedNote(metrics, [], []);
    expect(note).toContain('recall');
  });

  it('names a case whose outcome flipped', () => {
    const earlierPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: false, findingKey: null },
    ];
    const laterPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: true, findingKey: null },
    ];
    const note = derivedNote(metricsUnchanged, earlierPerCase, laterPerCase);
    expect(note).toContain('Case 1');
  });

  it('names a finding present in one run and absent in the other', () => {
    const earlierPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: true, findingKey: 'a.ts:1-2' },
    ];
    const laterPerCase: EvalCaseComparisonEntry[] = [
      { caseId: 'c1', caseName: 'Case 1', pass: true, findingKey: null },
    ];
    expect(derivedNote(metricsUnchanged, earlierPerCase, laterPerCase)).not.toBeNull();
  });
});

describe('trendPoints (AC-26, AC-47, NFR-3)', () => {
  it('keeps only complete runs, capped, newest-last', () => {
    const runs: EvalSetRun[] = [
      setRun({ id: 'newest', status: 'complete', ran_at: '2026-08-03T00:00:00.000Z' }),
      setRun({ id: 'mid-incomplete', status: 'incomplete', ran_at: '2026-08-02T00:00:00.000Z' }),
      setRun({ id: 'oldest', status: 'complete', ran_at: '2026-08-01T00:00:00.000Z' }),
    ];
    const points = trendPoints(runs);
    expect(points.map((p) => p.set_run_id)).toEqual(['oldest', 'newest']);
  });

  it(`caps at EVAL_MAX_TREND_POINTS (${EVAL_MAX_TREND_POINTS})`, () => {
    const runs: EvalSetRun[] = Array.from({ length: EVAL_MAX_TREND_POINTS + 5 }, (_, i) =>
      setRun({ id: `run-${i}`, status: 'complete', ran_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
    );
    expect(trendPoints(runs)).toHaveLength(EVAL_MAX_TREND_POINTS);
  });

  it('carries each metric plus an identifying set_run_id and config_version — the caller labels the series', () => {
    const runs: EvalSetRun[] = [setRun({ id: 'r1', config_version: 3, recall: 0.4 })];
    const [point] = trendPoints(runs);
    expect(point).toMatchObject({ set_run_id: 'r1', config_version: 3, recall: 0.4 });
  });
});
