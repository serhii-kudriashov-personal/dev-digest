import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type {
  FullSymbolRow,
  IndexerFileFactsRow,
  ResolvedCallerRow,
} from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * L06 Step 2 — `MAX_CALLERS_PER_SYMBOL` is applied PER changed symbol.
 *
 * Ring 2 is tested with a fake, not Postgres (`backend-onion-architecture` §9):
 * the service's `repo` is patched the same way
 * `repo-intel-facade-degraded.test.ts` patches it, so `tryPersistentBlast` runs
 * end to end with no container and no Docker.
 *
 * The previous semantics clamped the FLATTENED list, which handed every symbol
 * after the first zero callers — indistinguishable, to a consumer, from "this
 * symbol has no callers".
 */

const DECL_A = 'src/a.ts';
const DECL_B = 'src/b.ts';
const CALLERS_PER_SYMBOL = 25;

const INDEX_STATE: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'sha1',
  indexerVersion: 2,
  updatedAt: new Date(0),
};

/**
 * 25 callers per symbol, each in its own file, with a DESCENDING rank so the
 * expected "top 20" set is easy to state: caller `i` has rank `100 - i`.
 */
function callerRows(): ResolvedCallerRow[] {
  const rows: ResolvedCallerRow[] = [];
  for (const sym of ['alpha', 'beta']) {
    for (let i = 0; i < CALLERS_PER_SYMBOL; i++) {
      rows.push({
        fromPath: `src/callers/${sym}-${String(i).padStart(2, '0')}.ts`,
        toSymbol: sym,
        line: i + 1,
        rank: 100 - i,
      });
    }
  }
  return rows;
}

function buildService(callers: ResolvedCallerRow[]): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: {
      // Reaching these would mean the ripgrep fallback was entered.
      symbols: async () => {
        throw new Error('codeIndex.symbols must not be called');
      },
      references: async () => {
        throw new Error('codeIndex.references must not be called');
      },
    } as never,
  } as never;
  const svc = new RepoIntelService(container);
  const declRows: FullSymbolRow[] = [
    { path: DECL_A, name: 'alpha', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
    { path: DECL_B, name: 'beta', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
  ];
  const facts: IndexerFileFactsRow[] = [
    { filePath: 'src/callers/alpha-00.ts', endpoints: ['GET /x'], crons: ['job:poll_repos'] },
  ];
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => INDEX_STATE,
    // `getSymbolRows` serves two purposes in `tryPersistentBlast`: the declared
    // symbols of the changed files, and the enclosing symbols of the caller
    // files. Both go through the same method, so branch on the paths asked for.
    getSymbolRows: async (_repoId: string, paths: string[]): Promise<FullSymbolRow[]> =>
      paths.includes(DECL_A) ? declRows : [],
    getResolvedCallers: async () => callers,
    getFileFacts: async () => facts,
  };
  return svc;
}

function group(callers: { viaSymbol: string }[], sym: string) {
  return callers.filter((c) => c.viaSymbol === sym);
}

describe('tryPersistentBlast — the caller clamp is per changed symbol', () => {
  it('keeps MAX_CALLERS_PER_SYMBOL for EACH symbol, not 20 in total', async () => {
    const svc = buildService(callerRows());
    const blast = await svc.getBlastRadius('r1', [DECL_A, DECL_B]);

    expect(blast.degraded).toBe(false);
    expect(blast.changedSymbols).toHaveLength(2);
    expect(group(blast.callers, 'alpha')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(group(blast.callers, 'beta')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(blast.callers).toHaveLength(2 * MAX_CALLERS_PER_SYMBOL);
  });

  it('retains the 20 highest-ranked callers OF ITS OWN group', async () => {
    const svc = buildService(callerRows());
    const blast = await svc.getBlastRadius('r1', [DECL_A, DECL_B]);

    for (const sym of ['alpha', 'beta']) {
      const kept = group(blast.callers, sym);
      // rank 100 down to 81 — the five lowest-ranked of the 25 are dropped.
      expect(kept.map((c) => c.rank)).toEqual(
        Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => 100 - i),
      );
      expect(kept.every((c) => c.file.startsWith(`src/callers/${sym}-`))).toBe(true);
    }
  });

  it('is stable across two calls even when every rank ties', async () => {
    // Ranks all 0 — the collapsed-PageRank case. Only the (file, line) tiebreak
    // can make the clamp reproducible here.
    const tied = callerRows().map((c) => ({ ...c, rank: 0 }));
    const first = await buildService(tied).getBlastRadius('r1', [DECL_A, DECL_B]);
    const second = await buildService(tied).getBlastRadius('r1', [DECL_A, DECL_B]);

    expect(first.callers).toEqual(second.callers);
    expect(group(first.callers, 'alpha')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(group(first.callers, 'beta')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // Sorted by file ascending within the group, so the retained set is the
    // lexicographically first 20 of the 25.
    expect(group(first.callers, 'alpha').map((c) => c.file)).toEqual(
      Array.from(
        { length: MAX_CALLERS_PER_SYMBOL },
        (_, i) => `src/callers/alpha-${String(i).padStart(2, '0')}.ts`,
      ),
    );
  });

  it('carries factsByFile through so a consumer can attribute endpoints/crons', async () => {
    const svc = buildService(callerRows());
    const blast = await svc.getBlastRadius('r1', [DECL_A, DECL_B]);
    expect(blast.factsByFile?.['src/callers/alpha-00.ts']).toEqual({
      endpoints: ['GET /x'],
      crons: ['job:poll_repos'],
    });
  });
});
