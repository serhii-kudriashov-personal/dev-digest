import { describe, it, expect } from 'vitest';
import {
  decideBlastState,
  foldBlastResult,
  isSourceFile,
  summarizeBlast,
  toChangedSymbols,
  type BlastStateFacts,
} from '../src/modules/blast/helpers.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  MAX_CHANGED_SYMBOLS,
} from '../src/modules/blast/constants.js';
import type { BlastResult, SymbolRow } from '../src/modules/repo-intel/types.js';

/**
 * L06 Step 3 — the pure fold, the state truth table and the deterministic
 * summary. Hermetic: no container, no Postgres, no clock.
 */

/** A 'full', healthy index with the PR's files indexed — row 8 of the table. */
const HEALTHY: BlastStateFacts = {
  flagOn: true,
  indexStatus: 'full',
  lastIndexedSha: 'sha1',
  rankGraphPresent: true,
  sourceFileCount: 3,
  indexedSymbolCount: 12,
};

function sym(name: string, file: string, kind = 'function'): SymbolRow {
  return { file, name, kind, exported: true, startLine: 1, endLine: 2, signature: null };
}

describe('isSourceFile', () => {
  it('accepts the extensions the indexer parses and rejects the rest', () => {
    for (const p of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
      expect(isSourceFile(`src/${p}`)).toBe(true);
    }
    for (const p of ['README.md', 'pnpm-lock.yaml', 'a.py', 'a.d.tsx.snap', 'Dockerfile']) {
      expect(isSourceFile(p)).toBe(false);
    }
  });
});

describe('decideBlastState — all eight rows, in order', () => {
  it('row 1: the flag is off → degraded / flag_off (and outranks everything else)', () => {
    expect(decideBlastState({ ...HEALTHY, flagOn: false })).toEqual({
      state: 'degraded',
      reason: 'flag_off',
    });
    // First match wins: even a failed index is reported as flag_off.
    expect(
      decideBlastState({ ...HEALTHY, flagOn: false, indexStatus: 'failed' }),
    ).toEqual({ state: 'degraded', reason: 'flag_off' });
  });

  it('row 2: status=failed → degraded / index_failed', () => {
    expect(decideBlastState({ ...HEALTHY, indexStatus: 'failed' })).toEqual({
      state: 'degraded',
      reason: 'index_failed',
    });
  });

  it('row 3: status=degraded with no SHA → degraded / no_index', () => {
    expect(
      decideBlastState({ ...HEALTHY, indexStatus: 'degraded', lastIndexedSha: '' }),
    ).toEqual({ state: 'degraded', reason: 'no_index' });
  });

  it('row 4: status=degraded WITH a SHA → degraded / index_failed', () => {
    expect(
      decideBlastState({ ...HEALTHY, indexStatus: 'degraded', lastIndexedSha: 'sha1' }),
    ).toEqual({ state: 'degraded', reason: 'index_failed' });
  });

  it('row 5: status=partial with no rank graph → degraded / no_rank_graph', () => {
    expect(
      decideBlastState({ ...HEALTHY, indexStatus: 'partial', rankGraphPresent: false }),
    ).toEqual({ state: 'degraded', reason: 'no_rank_graph' });
  });

  it('row 6: source files changed but zero indexed symbols → partial / files_not_indexed', () => {
    expect(decideBlastState({ ...HEALTHY, indexedSymbolCount: 0 })).toEqual({
      state: 'partial',
      reason: 'files_not_indexed',
    });
    // Row 6 outranks row 7 — a partial index whose files are unindexed reports
    // the more specific, actionable reason.
    expect(
      decideBlastState({ ...HEALTHY, indexStatus: 'partial', indexedSymbolCount: 0 }),
    ).toEqual({ state: 'partial', reason: 'files_not_indexed' });
  });

  it('row 7: status=partial with a rank graph → partial / index_partial', () => {
    expect(decideBlastState({ ...HEALTHY, indexStatus: 'partial' })).toEqual({
      state: 'partial',
      reason: 'index_partial',
    });
  });

  it('row 8: otherwise → full / null', () => {
    expect(decideBlastState(HEALTHY)).toEqual({ state: 'full', reason: null });
    // No source files at all (an all-Markdown PR) is 'full', not 'files_not_indexed':
    // there is nothing the index could be missing.
    expect(
      decideBlastState({ ...HEALTHY, sourceFileCount: 0, indexedSymbolCount: 0 }),
    ).toEqual({ state: 'full', reason: null });
  });
});

describe('toChangedSymbols', () => {
  it('dedupes on name+file, drops the qualified Class.method dual-emit, sorts by (file, name)', () => {
    const out = toChangedSymbols([
      sym('zeta', 'src/b.ts'),
      sym('Widget.render', 'src/a.ts', 'method'),
      sym('alpha', 'src/b.ts'),
      sym('render', 'src/a.ts', 'method'),
      sym('alpha', 'src/b.ts'),
    ]);
    expect(out).toEqual([
      { name: 'render', file: 'src/a.ts', kind: 'method' },
      { name: 'alpha', file: 'src/b.ts', kind: 'function' },
      { name: 'zeta', file: 'src/b.ts', kind: 'function' },
    ]);
  });

  it('caps at MAX_CHANGED_SYMBOLS', () => {
    const rows = Array.from({ length: MAX_CHANGED_SYMBOLS + 15 }, (_, i) =>
      sym(`s${String(i).padStart(3, '0')}`, 'src/a.ts'),
    );
    expect(toChangedSymbols(rows)).toHaveLength(MAX_CHANGED_SYMBOLS);
  });
});

describe('foldBlastResult', () => {
  const base: BlastResult = {
    changedSymbols: [
      { name: 'alpha', file: 'src/a.ts', kind: 'function' },
      { name: 'beta', file: 'src/b.ts', kind: 'function' },
    ],
    callers: [],
    impactedEndpoints: [],
    factsByFile: {},
    degraded: false,
  };

  it("excludes a caller sitting in the symbol's OWN declaring file", () => {
    const out = foldBlastResult({
      ...base,
      callers: [
        { file: 'src/a.ts', symbol: 'helperInA', viaSymbol: 'alpha', line: 9, rank: 5 },
        { file: 'src/c.ts', symbol: 'realCaller', viaSymbol: 'alpha', line: 4, rank: 1 },
      ],
    });
    expect(out[0]!.callers).toEqual([{ name: 'realCaller', file: 'src/c.ts', line: 4 }]);
  });

  it('clamps to MAX_CALLERS_PER_SYMBOL keeping the top rows of the total order', () => {
    const callers = Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) => ({
      file: `src/c${String(i).padStart(2, '0')}.ts`,
      symbol: `c${i}`,
      viaSymbol: 'alpha',
      line: 1,
      rank: 100 - i,
    }));
    // Shuffle the input so the fold's own sort is what produces the order.
    const out = foldBlastResult({ ...base, callers: [...callers].reverse() });
    expect(out[0]!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(out[0]!.callers.map((c) => c.file)).toEqual(
      callers.slice(0, MAX_CALLERS_PER_SYMBOL).map((c) => c.file),
    );
  });

  it('attributes factsByFile to the RIGHT symbol, deduped and sorted', () => {
    const out = foldBlastResult({
      ...base,
      callers: [
        { file: 'src/c.ts', symbol: 'c', viaSymbol: 'alpha', line: 1, rank: 9 },
        { file: 'src/d.ts', symbol: 'd', viaSymbol: 'alpha', line: 2, rank: 8 },
        { file: 'src/e.ts', symbol: 'e', viaSymbol: 'beta', line: 3, rank: 7 },
      ],
      factsByFile: {
        'src/c.ts': { endpoints: ['POST /z', 'GET /x'], crons: ['job:poll_repos'] },
        'src/d.ts': { endpoints: ['GET /x'], crons: [] },
        'src/e.ts': { endpoints: ['GET /only-beta'], crons: ['0 * * * *'] },
      },
    });
    expect(out[0]!.symbol).toBe('alpha');
    expect(out[0]!.endpoints_affected).toEqual(['GET /x', 'POST /z']);
    expect(out[0]!.crons_affected).toEqual(['job:poll_repos']);
    expect(out[1]!.symbol).toBe('beta');
    expect(out[1]!.endpoints_affected).toEqual(['GET /only-beta']);
    expect(out[1]!.crons_affected).toEqual(['0 * * * *']);
  });

  it('emits a symbol with ZERO callers rather than dropping it', () => {
    const out = foldBlastResult({
      ...base,
      callers: [{ file: 'src/c.ts', symbol: 'c', viaSymbol: 'alpha', line: 1, rank: 1 }],
    });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      symbol: 'beta',
      callers: [],
      endpoints_affected: [],
      crons_affected: [],
    });
  });

  it('does not throw when factsByFile is absent entirely', () => {
    const { factsByFile: _drop, ...noFacts } = base;
    const out = foldBlastResult({
      ...noFacts,
      callers: [{ file: 'src/c.ts', symbol: 'c', viaSymbol: 'alpha', line: 1, rank: 1 }],
    });
    expect(out[0]!.endpoints_affected).toEqual([]);
    expect(out[0]!.crons_affected).toEqual([]);
  });
});

describe('summarizeBlast', () => {
  const changed = [
    { name: 'alpha', file: 'src/a.ts', kind: 'function' },
    { name: 'beta', file: 'src/b.ts', kind: 'function' },
  ];
  const downstream = [
    {
      symbol: 'alpha',
      callers: [
        { name: 'c', file: 'src/c.ts', line: 1 },
        { name: 'd', file: 'src/d.ts', line: 2 },
      ],
      endpoints_affected: ['GET /x'],
      crons_affected: ['job:poll_repos'],
    },
    { symbol: 'beta', callers: [], endpoints_affected: [], crons_affected: [] },
  ];

  it('full with callers: counts symbols, callers, files, endpoints and crons', () => {
    expect(summarizeBlast(changed, downstream, 'full', null)).toBe(
      '2 changed symbols reach 2 callers in 2 files; 1 HTTP endpoint and 1 cron may be affected.',
    );
  });

  it('singularises every count AND the verb', () => {
    const one = [{ ...downstream[0]!, callers: [downstream[0]!.callers[0]!] }];
    expect(summarizeBlast([changed[0]!], one, 'partial', 'index_partial')).toBe(
      '1 changed symbol reaches 1 caller in 1 file; 1 HTTP endpoint and 1 cron may be affected.',
    );
  });

  it('zero callers is distinct from degraded', () => {
    expect(summarizeBlast(changed, [downstream[1]!], 'full', null)).toBe(
      '2 changed symbols; no downstream callers found in the index.',
    );
  });

  it('zero symbols', () => {
    expect(summarizeBlast([], [], 'full', null)).toBe('No code symbols changed in this PR.');
  });

  it('every degraded reason produces a non-empty, reason-specific sentence', () => {
    const reasons = [
      'flag_off',
      'no_index',
      'index_failed',
      'no_rank_graph',
      'files_not_indexed',
      'index_partial',
    ] as const;
    const seen = new Set<string>();
    for (const reason of reasons) {
      const text = summarizeBlast(changed, [], 'degraded', reason);
      expect(text.startsWith('Blast radius unavailable: ')).toBe(true);
      expect(text.length).toBeGreaterThan('Blast radius unavailable: .'.length);
      seen.add(text);
    }
    expect(seen.size).toBe(reasons.length);
    // A null reason still yields text rather than "undefined".
    expect(summarizeBlast(changed, [], 'degraded', null)).toContain('unusable');
  });

  it('is deterministic — the same inputs give byte-identical text', () => {
    expect(summarizeBlast(changed, downstream, 'full', null)).toBe(
      summarizeBlast(changed, downstream, 'full', null),
    );
  });
});
