/**
 * Pure transforms: engine payload → the concise object a tool returns.
 *
 * The design rule is "concise structured response", and the fields that are
 * DROPPED are as deliberate as the ones kept:
 *
 *  - every UUID (`id`, `review_id`, `agent_id`, `run_id`) — dropping them is
 *    what makes the flat-argument contract self-enforcing, because the model is
 *    never handed an identifier it could pass back into a tool;
 *  - `confidence` — not calibrated (root `INSIGHTS.md` 2026-08-02: the model
 *    emits 1.0 for hallucinations just as readily), so surfacing it into another
 *    model's context is worse than omitting it;
 *  - `rationale` — the longest markdown field on the contract, and of marginal
 *    value to a model that already has the title, file and suggestion. Dropped
 *    whole rather than truncated;
 *  - `accepted_at`, `dismissed_at`, `kind`, `skill`, `scope`,
 *    `trifecta_components`, `evidence` — review-workflow state this client has
 *    no use for.
 */
import {
  MAX_BLAST_CALLERS_PER_SYMBOL,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_PATH_CHARS,
  MAX_BLAST_SYMBOLS,
  MAX_CONVENTIONS,
  MAX_FINDINGS,
  MAX_RULE_CHARS,
  MAX_SUGGESTION_CHARS,
  MAX_TITLE_CHARS,
} from './constants.js';
import { clean, fenceUntrusted } from './sanitize.js';
import type { Agent, ConventionCandidate, Finding, McpBlast, McpReview } from './types.js';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export interface ConciseFinding {
  severity: string;
  category: string;
  title: string;
  file: string;
  lines: string;
  suggestion?: string;
}

export interface ConciseReview {
  verdict: string | null;
  score: number | null;
  counts: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  findings: ConciseFinding[];
  truncated?: string;
  trace_url?: string;
}

function lineRange(finding: Finding): string {
  return finding.start_line === finding.end_line
    ? String(finding.start_line)
    : `${finding.start_line}-${finding.end_line}`;
}

export function countBySeverity(findings: Finding[]): ConciseReview['counts'] {
  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const finding of findings) {
    if (finding.severity in counts) counts[finding.severity] += 1;
  }
  return counts;
}

export function toConciseFinding(finding: Finding): ConciseFinding {
  const shaped: ConciseFinding = {
    severity: finding.severity,
    category: finding.category,
    // Third-party prose: fenced. See `sanitize.ts` for what that does and does
    // not buy.
    title: fenceUntrusted('title', finding.title, MAX_TITLE_CHARS),
    file: clean(finding.file, 300),
    lines: lineRange(finding),
  };
  if (finding.suggestion) {
    shaped.suggestion = fenceUntrusted('suggestion', finding.suggestion, MAX_SUGGESTION_CHARS);
  }
  return shaped;
}

/**
 * Sort CRITICAL → WARNING → SUGGESTION, keep the top `MAX_FINDINGS`, and say so
 * explicitly when something was cut. `counts` is computed over ALL findings, so
 * the tally never lies about what the review found.
 */
export function toConciseReview(review: McpReview, traceUrl?: string): ConciseReview {
  const sorted = [...review.findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
  const kept = sorted.slice(0, MAX_FINDINGS);
  const dropped = sorted.length - kept.length;

  const shaped: ConciseReview = {
    verdict: review.verdict,
    score: review.score,
    counts: countBySeverity(review.findings),
    findings: kept.map(toConciseFinding),
  };
  if (dropped > 0) {
    shaped.truncated = `${dropped} more finding${dropped === 1 ? '' : 's'} not shown (lower severity)`;
  }
  if (traceUrl) shaped.trace_url = traceUrl;
  return shaped;
}

/** Newest review first, optionally filtered to one agent by name. */
export function latestReview(reviews: McpReview[], agentName?: string): McpReview | undefined {
  const candidates = agentName
    ? reviews.filter((r) => (r.agent_name ?? '').toLowerCase() === agentName.toLowerCase())
    : reviews;
  return [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function reviewForRun(reviews: McpReview[], runId: string): McpReview | undefined {
  return reviews.find((r) => r.run_id === runId);
}

/**
 * `{name, model, enabled}` and nothing else. `id` is dropped on purpose: the
 * name IS the value every other tool takes.
 */
export function toConciseAgents(agents: Agent[]): Array<{
  name: string;
  model: string;
  enabled: boolean;
}> {
  return agents.map((agent) => ({
    name: clean(agent.name, 200),
    model: clean(agent.model, 200),
    enabled: agent.enabled,
  }));
}

export interface ConciseConventions {
  conventions: Array<{ rule: string; category: string; evidence_path: string }>;
  truncated?: string;
}

/**
 * Accepted candidates only (`ConventionStatus`, `knowledge.ts:226`). Drops
 * `evidence_snippet` (large, and the highest-risk untrusted text in the
 * payload), `confidence`, `id`, and the line numbers.
 */
export function toConciseConventions(candidates: ConventionCandidate[]): ConciseConventions {
  const accepted = candidates.filter((c) => c.status === 'accepted');
  const kept = accepted.slice(0, MAX_CONVENTIONS);
  const shaped: ConciseConventions = {
    conventions: kept.map((c) => ({
      rule: fenceUntrusted('rule', c.rule, MAX_RULE_CHARS),
      category: c.category,
      evidence_path: clean(c.evidence_path, 300),
    })),
  };
  const dropped = accepted.length - kept.length;
  if (dropped > 0) shaped.truncated = `${dropped} more`;
  return shaped;
}

// ---- Blast radius --------------------------------------------------------

export interface ConciseBlastSymbol {
  symbol: string;
  file: string;
  kind: string;
  /** The UNTRUNCATED count, so the caps below never understate the fan-out. */
  caller_count: number;
  /** `"file:line"` strings — flat, and one token cheaper than an object each. */
  callers: string[];
  endpoints?: string[];
  crons?: string[];
}

export interface ConciseBlast {
  state: string;
  summary: string;
  changed_symbols: ConciseBlastSymbol[];
  truncated?: string;
  /** Present only when the index is incomplete — why the answer may be partial. */
  note?: string;
}

/**
 * Engine payload → the concise object `get_blast_radius` returns.
 *
 * Dropped, in the same spirit as `toConciseReview`: every UUID (there is none on
 * this contract, and none is added), `rank` (never on the wire), and the
 * `reason` MACHINE CODE — the caller turns it into a `note` sentence instead,
 * because a bare `no_rank_graph` tells a model nothing it can act on.
 *
 * Every string that reaches the model is repo-authored text — file paths, symbol
 * names, endpoint and cron strings, and the server's own `summary` — so all of
 * them go through `clean()` (control characters stripped, length capped). They
 * are NOT `fenceUntrusted`'d: these are identifiers and short machine-shaped
 * labels, not third-party prose like a finding title.
 */
export function toConciseBlast(payload: McpBlast, note?: string): ConciseBlast {
  // Keyed by `symbol:file`, not `symbol` alone: two changed symbols can share a
  // bare name from different declaring files, and a name-only key would let one
  // entry's callers silently mask the other's.
  const downstreamBySymbol = new Map(
    payload.downstream.map((d) => [`${d.symbol}:${d.file}`, d]),
  );

  const kept = payload.changed_symbols.slice(0, MAX_BLAST_SYMBOLS);
  const shaped: ConciseBlast = {
    state: payload.state,
    summary: clean(payload.summary, MAX_TITLE_CHARS),
    changed_symbols: kept.map((sym) => {
      const entry = downstreamBySymbol.get(`${sym.name}:${sym.file}`);
      const callers = entry?.callers ?? [];
      const out: ConciseBlastSymbol = {
        symbol: clean(sym.name, MAX_BLAST_PATH_CHARS),
        file: clean(sym.file, MAX_BLAST_PATH_CHARS),
        kind: clean(sym.kind, 60),
        caller_count: callers.length,
        callers: callers
          .slice(0, MAX_BLAST_CALLERS_PER_SYMBOL)
          .map((c) => `${clean(c.file, MAX_BLAST_PATH_CHARS)}:${c.line}`),
      };
      const endpoints = (entry?.endpoints_affected ?? []).slice(0, MAX_BLAST_ENDPOINTS);
      const crons = (entry?.crons_affected ?? []).slice(0, MAX_BLAST_ENDPOINTS);
      if (endpoints.length > 0) out.endpoints = endpoints.map((e) => clean(e, 200));
      if (crons.length > 0) out.crons = crons.map((c) => clean(c, 200));
      return out;
    }),
  };

  const dropped = payload.changed_symbols.length - kept.length;
  if (dropped > 0) {
    shaped.truncated = `showing ${kept.length} of ${payload.changed_symbols.length} changed symbols`;
  }
  if (note) shaped.note = note;
  return shaped;
}
