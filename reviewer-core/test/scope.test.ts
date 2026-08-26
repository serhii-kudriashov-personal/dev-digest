/**
 * applyScopeGate — the deterministic out-of-scope filter (L03).
 *
 * The behaviours pinned here are the ones the gate exists to guarantee: a
 * provable no-op without intent, an unconditional CRITICAL escape hatch, a
 * collapse to a single signal, and no reordering. Every drop carries a reason,
 * because a suppression that leaves no record is indistinguishable from a
 * finding that was never made.
 */
import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { applyScopeGate, scopeSummary } from '../src/scope.js';

function finding(over: Partial<Finding> & { id: string }): Finding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${over.id}`,
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    confidence: 0.5,
    ...over,
  } as Finding;
}

describe('applyScopeGate — no intent means no behaviour change', () => {
  it('returns the SAME array identity and drops nothing', () => {
    const fs = [
      finding({ id: 'a', scope: 'out_of_scope' }),
      finding({ id: 'b', scope: 'out_of_scope', severity: 'SUGGESTION' }),
    ];
    const res = applyScopeGate(fs, false);
    // Identity, not deep equality: "provably a no-op" is the requirement.
    expect(res.kept).toBe(fs);
    expect(res.dropped).toEqual([]);
  });
});

describe('applyScopeGate — the CRITICAL escape hatch', () => {
  it('keeps an out-of-scope CRITICAL, and still lets one other signal through', () => {
    const crit = finding({ id: 'c', scope: 'out_of_scope', severity: 'CRITICAL' });
    const sugg = finding({ id: 's', scope: 'out_of_scope', severity: 'SUGGESTION' });
    const res = applyScopeGate([crit, sugg], true);
    expect(res.kept).toContain(crit);
    expect(res.kept).toContain(sugg);
    expect(res.dropped).toHaveLength(0);
  });

  it('keeps ALL out-of-scope CRITICALs — the hatch is not a quota of one', () => {
    const fs = [
      finding({ id: 'c1', scope: 'out_of_scope', severity: 'CRITICAL' }),
      finding({ id: 'c2', scope: 'out_of_scope', severity: 'CRITICAL' }),
      finding({ id: 'c3', scope: 'out_of_scope', severity: 'CRITICAL' }),
    ];
    const res = applyScopeGate(fs, true);
    expect(res.kept).toHaveLength(3);
    expect(res.dropped).toHaveLength(0);
  });
});

describe('applyScopeGate — collapse of out-of-scope noise', () => {
  it('keeps exactly one (the highest severity) and drops the rest with a reason', () => {
    const fs = [
      finding({ id: 's1', scope: 'out_of_scope', severity: 'SUGGESTION' }),
      finding({ id: 'w1', scope: 'out_of_scope', severity: 'WARNING' }),
      finding({ id: 's2', scope: 'out_of_scope', severity: 'SUGGESTION' }),
      finding({ id: 's3', scope: 'out_of_scope', severity: 'SUGGESTION' }),
    ];
    const res = applyScopeGate(fs, true);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0]!.id).toBe('w1');
    expect(res.dropped).toHaveLength(3);
    for (const d of res.dropped) {
      expect(d.reason).toMatch(/out of the PR's stated scope/);
      expect(d.reason).toMatch(/3 similar dropped/);
    }
  });

  it('breaks a severity tie by input order', () => {
    const fs = [
      finding({ id: 'first', scope: 'out_of_scope' }),
      finding({ id: 'second', scope: 'out_of_scope' }),
    ];
    const res = applyScopeGate(fs, true);
    expect(res.kept.map((f) => f.id)).toEqual(['first']);
  });
});

describe('applyScopeGate — passthrough and ordering', () => {
  it('keeps null, undefined and in_scope labels when intent IS present', () => {
    const fs = [
      finding({ id: 'n', scope: null }),
      finding({ id: 'u' }), // undefined — the key is simply absent
      finding({ id: 'i', scope: 'in_scope' }),
    ];
    const res = applyScopeGate(fs, true);
    expect(res.kept).toHaveLength(3);
    expect(res.dropped).toHaveLength(0);
  });

  it('never reorders the kept findings', () => {
    const fs = [
      finding({ id: 'a', scope: 'in_scope' }),
      finding({ id: 'drop', scope: 'out_of_scope', severity: 'SUGGESTION' }),
      finding({ id: 'b', scope: null }),
      finding({ id: 'keep', scope: 'out_of_scope', severity: 'WARNING' }),
      finding({ id: 'c', scope: 'in_scope' }),
    ];
    const res = applyScopeGate(fs, true);
    expect(res.kept.map((f) => f.id)).toEqual(['a', 'b', 'keep', 'c']);
  });

  it('summarises as kept/total in scope', () => {
    const fs = [
      finding({ id: 'a', scope: 'in_scope' }),
      finding({ id: 'x', scope: 'out_of_scope', severity: 'SUGGESTION' }),
      finding({ id: 'y', scope: 'out_of_scope', severity: 'SUGGESTION' }),
    ];
    expect(scopeSummary(applyScopeGate(fs, true))).toBe('2/3 in scope');
  });
});
