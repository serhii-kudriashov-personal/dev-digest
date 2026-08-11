import type {
  BlastCaller,
  BlastState,
  BlastStateReason,
  ChangedSymbol,
  DownstreamImpact,
} from '@devdigest/shared';
import { SUPPORTED_EXT } from '../repo-intel/constants.js';
import type { BlastResult, IndexStatus, SymbolRow } from '../repo-intel/types.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  MAX_CHANGED_SYMBOLS,
  MAX_CRONS_PER_SYMBOL,
  MAX_ENDPOINTS_PER_SYMBOL,
} from './constants.js';

/**
 * Blast Radius slice — PURE transforms. No I/O, no DB, no container, no clock.
 *
 * These live in ring 2 rather than in `reviewer-core` deliberately: purity is not
 * an address (root `INSIGHTS.md` 2026-08-09). They consume `pr_files` paths and
 * the `repo-intel` read model and produce a UI transport contract that no engine
 * path calls. If the review pipeline ever wants a blast radius for a prompt slot,
 * this MOVES to `reviewer-core` taking the folded data as a parameter — it is not
 * duplicated there.
 */

/**
 * Is this a file the indexer could have parsed? `SUPPORTED_EXT` is imported from
 * the sibling slice's `constants.ts`, which is public surface — a slice's
 * `service`/`repository`/`routes`/`helpers` are not (`.dependency-cruiser.cjs`
 * `SLICE_PRIVATE`).
 */
export function isSourceFile(path: string): boolean {
  return SUPPORTED_EXT.some((ext) => path.endsWith(ext));
}

/** The facts `decideBlastState` needs, and nothing else. */
export interface BlastStateFacts {
  /** `config.repoIntelEnabled`. */
  flagOn: boolean;
  indexStatus: IndexStatus;
  /** `''` when no `repo_index_state` row exists — what tells "never indexed" apart. */
  lastIndexedSha: string;
  /** Whether `file_rank` has any row at all. Only meaningful when status is 'partial'. */
  rankGraphPresent: boolean;
  /** How many of the PR's changed files the indexer could have parsed. */
  sourceFileCount: number;
  /** How many symbols the index actually holds for those files. */
  indexedSymbolCount: number;
}

export interface BlastStateDecision {
  state: BlastState;
  reason: BlastStateReason | null;
}

/**
 * The state truth table — ORDERED, first match wins.
 *
 * Written as a sequence of early returns on purpose: the order IS the code, so
 * reordering two clauses is a visible edit rather than a subtle one. Row 5 is the
 * row the whole feature exists for: `status='partial'` can mean the entire T3
 * block was skipped, in which case `file_edges`/`file_rank`/`file_facts` were
 * never written and `getResolvedCallers`' INNER JOIN to `file_rank` yields zero
 * rows — indistinguishable from "this symbol has no callers". Reporting
 * `no_rank_graph` is what keeps that from being masked as an honest empty result.
 */
export function decideBlastState(facts: BlastStateFacts): BlastStateDecision {
  // 1 — the feature is switched off for this installation.
  if (!facts.flagOn) return { state: 'degraded', reason: 'flag_off' };

  // 2 — the last index run failed outright.
  if (facts.indexStatus === 'failed') return { state: 'degraded', reason: 'index_failed' };

  // 3 — 'degraded' with no SHA is the synthesised no-row state (`getIndexState`).
  if (facts.indexStatus === 'degraded' && facts.lastIndexedSha === '') {
    return { state: 'degraded', reason: 'no_index' };
  }

  // 4 — 'degraded' with a SHA: a real row that the indexer marked unusable.
  if (facts.indexStatus === 'degraded') return { state: 'degraded', reason: 'index_failed' };

  // 5 — partial WITHOUT a rank graph: callers cannot be resolved at all.
  if (facts.indexStatus === 'partial' && !facts.rankGraphPresent) {
    return { state: 'degraded', reason: 'no_rank_graph' };
  }

  // 6 — the index works, but this PR's source files are not in it yet.
  if (facts.sourceFileCount > 0 && facts.indexedSymbolCount === 0) {
    return { state: 'partial', reason: 'files_not_indexed' };
  }

  // 7 — a working but incomplete index.
  if (facts.indexStatus === 'partial') return { state: 'partial', reason: 'index_partial' };

  // 8 — nothing to report.
  return { state: 'full', reason: null };
}

/**
 * The changed symbols the PR's files declare, as the wire shape.
 *
 * Drops the qualified `Class.method` dual-emit the indexer writes alongside the
 * bare name (matching `repo-intel/service.ts`'s own `name.includes('.')` skip) —
 * otherwise every method appears twice, once with no resolvable callers.
 */
export function toChangedSymbols(rows: SymbolRow[]): ChangedSymbol[] {
  const seen = new Set<string>();
  const out: ChangedSymbol[] = [];
  for (const row of rows) {
    if (row.name.includes('.')) continue;
    const key = `${row.name}:${row.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: row.name, file: row.file, kind: row.kind });
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  return out.slice(0, MAX_CHANGED_SYMBOLS);
}

function capped(values: Iterable<string>, cap: number): string[] {
  return [...new Set(values)].sort().slice(0, cap);
}

/**
 * Fold a facade `BlastResult` into the wire `downstream` array.
 *
 * Three things this does that the facade does not:
 *
 * 1. **Excludes a caller sitting in the symbol's own declaring file.** The
 *    persistent path has no such filter (only the ripgrep path does), and "who
 *    else calls this" is the question the feature answers — a reference inside
 *    the declaration is not a downstream consumer.
 * 2. **Emits one entry per changed symbol, including symbols with zero callers**,
 *    so the UI can render a `0` badge rather than silently dropping the symbol.
 * 3. **Attributes `endpoints_affected` / `crons_affected` per symbol** from
 *    `factsByFile` on that symbol's own retained callers, instead of the flat
 *    `impactedEndpoints` union. A missing `factsByFile` is treated as `{}` —
 *    `tryPersistentBlast`'s zero-symbol early return omits the key entirely.
 */
export function foldBlastResult(result: BlastResult): DownstreamImpact[] {
  const declFileBySymbol = new Map<string, string>();
  for (const sym of result.changedSymbols) {
    if (!declFileBySymbol.has(sym.name)) declFileBySymbol.set(sym.name, sym.file);
  }
  const facts = result.factsByFile ?? {};

  const bySymbol = new Map<string, typeof result.callers>();
  for (const row of result.callers) {
    if (row.file === declFileBySymbol.get(row.viaSymbol)) continue;
    const group = bySymbol.get(row.viaSymbol);
    if (group) group.push(row);
    else bySymbol.set(row.viaSymbol, [row]);
  }

  const out: DownstreamImpact[] = [];
  for (const sym of result.changedSymbols) {
    if (sym.name.includes('.')) continue;
    const group = [...(bySymbol.get(sym.name) ?? [])];
    // `rank` is a SORT KEY only — it is an uncalibrated absolute PageRank number
    // with no units a reviewer could read, and `BlastCaller` has no field for it.
    group.sort(
      (a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line,
    );
    const kept = group.slice(0, MAX_CALLERS_PER_SYMBOL);

    const callers: BlastCaller[] = kept.map((row) => ({
      name: row.symbol,
      file: row.file,
      line: row.line,
    }));
    const endpoints: string[] = [];
    const crons: string[] = [];
    for (const row of kept) {
      const fact = facts[row.file];
      if (!fact) continue;
      endpoints.push(...fact.endpoints);
      crons.push(...fact.crons);
    }

    out.push({
      symbol: sym.name,
      callers,
      endpoints_affected: capped(endpoints, MAX_ENDPOINTS_PER_SYMBOL),
      crons_affected: capped(crons, MAX_CRONS_PER_SYMBOL),
    });
  }
  return out;
}

/** Plain-English rendering of a machine reason code, for the degraded summary. */
const REASON_PROSE: Record<BlastStateReason, string> = {
  flag_off: 'code indexing is switched off for this installation',
  no_index: 'this repository has not been indexed yet',
  index_failed: 'the last index run failed',
  no_rank_graph: 'the index is incomplete and the import graph was never built',
  files_not_indexed: 'the changed files are not in the index yet',
  index_partial: 'the index is incomplete',
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The `summary` string — a DETERMINISTIC template, not a model call.
 *
 * Two identical requests must produce byte-identical text, which is what makes
 * this feature free and reproducible. Pluralisation is not localized here: this
 * string is server-side data (the same class as `intent.intent`), and the card's
 * own labels come from `messages/en/blast.json`.
 */
export function summarizeBlast(
  changed: ChangedSymbol[],
  downstream: DownstreamImpact[],
  state: BlastState,
  reason: BlastStateReason | null,
): string {
  if (state === 'degraded') {
    const prose = reason ? REASON_PROSE[reason] : 'the persisted index is unusable';
    return `Blast radius unavailable: ${prose}.`;
  }
  if (changed.length === 0) return 'No code symbols changed in this PR.';

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  if (callerCount === 0) {
    return `${plural(changed.length, 'changed symbol', 'changed symbols')}; no downstream callers found in the index.`;
  }

  const fileCount = new Set(downstream.flatMap((d) => d.callers.map((c) => c.file))).size;
  const endpointCount = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(downstream.flatMap((d) => d.crons_affected)).size;

  return (
    `${plural(changed.length, 'changed symbol', 'changed symbols')} ` +
    `${changed.length === 1 ? 'reaches' : 'reach'} ` +
    `${plural(callerCount, 'caller', 'callers')} in ${plural(fileCount, 'file', 'files')}; ` +
    `${plural(endpointCount, 'HTTP endpoint', 'HTTP endpoints')} and ` +
    `${plural(cronCount, 'cron', 'crons')} may be affected.`
  );
}
