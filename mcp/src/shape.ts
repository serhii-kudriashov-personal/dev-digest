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
  MAX_CONVENTIONS,
  MAX_FINDINGS,
  MAX_RULE_CHARS,
  MAX_SUGGESTION_CHARS,
  MAX_TITLE_CHARS,
} from './constants.js';
import { clean, fenceUntrusted } from './sanitize.js';
import type { Agent, ConventionCandidate, Finding, McpReview } from './types.js';

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
