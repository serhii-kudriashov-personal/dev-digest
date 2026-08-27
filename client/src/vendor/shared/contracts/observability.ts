import { z } from 'zod';
import { Severity, SeverityCounts } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (SPEC-05, L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentStartRequest  body of POST /pulls/:id/multi-agent-runs
 *   - MultiAgentRunSummary    that route's response, and each element of
 *                             GET /pulls/:id/multi-agent-runs
 *   - AgentLane               one member run's lane, as returned inside
 *                             GET /multi-agent-runs/:id
 *   - LocationStance / GroupedLocation   where agents agree or disagree on a
 *                             file:line range, computed from persisted
 *                             findings — never stored
 *   - MultiAgentRunResult     response of GET /multi-agent-runs/:id
 *   - AgentHistoryRow         response element of GET /multi-agent/agent-history
 *   - AgentStats              per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult           the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review (SPEC-05)
// ---------------------------------------------------------------------------

/**
 * Body of `POST /pulls/:id/multi-agent-runs`. The `8` cap is NFR-3's hard
 * limit; it is a literal here (ring 0 imports only `zod` — `shared-is-a-leaf`)
 * and is re-declared as `MAX_AGENTS_PER_RUN` in `modules/multi-agent/constants.ts`.
 */
export const MultiAgentStartRequest = z.object({
  agent_ids: z.array(z.string().uuid()).min(1).max(8),
});
export type MultiAgentStartRequest = z.infer<typeof MultiAgentStartRequest>;

/**
 * The start response (AC-16) and each element of the run-history list
 * (AC-17, AC-18). The record exists — with every member id — before any
 * member run completes.
 */
export const MultiAgentRunSummary = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  member_run_ids: z.array(z.string()),
});
export type MultiAgentRunSummary = z.infer<typeof MultiAgentRunSummary>;

/**
 * One member run's lane, inside `MultiAgentRunResult`. `agent_name` is the
 * name recorded at run time so it survives the agent's later deletion (spec
 * §Edge cases). `findings` is the FULL `FindingRecord`, not a reduced shape —
 * AC-36 needs `rationale`/`suggestion`, AC-37 `confidence`, AC-40/41
 * `accepted_at`/`dismissed_at`, and AC-49 needs exactly what
 * `RunTraceDrawer`'s `findings?: FindingRecord[]` prop takes.
 */
export const AgentLane = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  /** Failure reason when status='failed' (AC-19, AC-33). */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord),
  /** True count behind `findings`, which is capped (NFR-3's "shown of total"). */
  findings_total: z.number().int(),
});
export type AgentLane = z.infer<typeof AgentLane>;

/**
 * One agent's stance on a `GroupedLocation`. Deliberately carries NO free-text
 * field — a did-not-flag entry must be reconstructible from `flagged` alone
 * (AC-25), never from a model-authored "note" that could smuggle a rationale
 * for silence.
 */
export const LocationStance = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  run_id: z.string(),
  flagged: z.boolean(),
  severity: Severity.nullable(),
  finding_ids: z.array(z.string()),
});
export type LocationStance = z.infer<typeof LocationStance>;

/**
 * A file:line RANGE (not a single line — AC-21) that at least one completed
 * agent flagged, with one stance per completed lane. `conflict` is the
 * server's deterministic verdict (AC-26, NFR-5), computed from the stances,
 * never from the model's own `confidence`.
 */
export const GroupedLocation = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  stances: z.array(LocationStance),
  conflict: z.boolean(),
});
export type GroupedLocation = z.infer<typeof GroupedLocation>;

/**
 * Response of `GET /multi-agent-runs/:id`. Wire-only: computed fresh on every
 * read and persisted nowhere, which is why every new field here is
 * `.nullable()` rather than `.nullish()` — "present, value unknown" is the
 * right semantic for a DTO with no jsonb document behind it.
 *
 * `total_duration_ms` is null until every member has settled (AC-31);
 * `total_cost_usd` sums the known costs and is null only when every one is
 * unknown (AC-32, NFR-4) — unknown cost is never `0`.
 */
export const MultiAgentRunResult = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullable(),
  repo_id: z.string(),
  ran_at: z.string(),
  /** `multi_agent_runs.head_sha` !== the pull's CURRENT head_sha, computed at
   *  read time (AC-46) — never stored, same pattern as `PrIntentRecord.stale`. */
  stale: z.boolean(),
  lanes: z.array(AgentLane),
  locations: z.array(GroupedLocation),
  /** True count behind `locations`, which is capped (NFR-3). */
  locations_total: z.number().int(),
  completed_lane_count: z.number().int(),
  total_duration_ms: z.number().int().nullable(),
  total_cost_usd: z.number().nullable(),
});
export type MultiAgentRunResult = z.infer<typeof MultiAgentRunResult>;

/**
 * One row of `GET /multi-agent/agent-history` — every agent in the
 * workspace (enabled or not), with its last COMPLETED run if it has one.
 * Feeds the Configure-run screen's pre-run estimate and per-agent history
 * card (AC-10, AC-11, Open question 6).
 */
export const AgentHistoryRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  enabled: z.boolean(),
  model: z.string().nullable(),
  last_run: z
    .object({
      run_id: z.string(),
      ran_at: z.string(),
      duration_ms: z.number().int().nullable(),
      cost_usd: z.number().nullable(),
      summary: z.string().nullable(),
      pr_number: z.number().int().nullish(),
    })
    .nullable(),
});
export type AgentHistoryRow = z.infer<typeof AgentHistoryRow>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: SeverityCounts,
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
