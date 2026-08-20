/**
 * Eval slice literals (L06, SPEC-04) — caps (NFR-3), budgets (NFR-2) and the
 * concurrency ceiling (NFR-7). `constants.ts` is the slice's PUBLIC surface
 * (`backend-onion-architecture` §13): another slice, or a client-facing cap
 * message, may import these directly.
 */

/** A case set is capped so the run list and the case list stay boundable (NFR-3). */
export const EVAL_MAX_CASES_PER_AGENT = 50;

/** A case's frozen diff fragment must stay small — this is a fixture, not a PR. */
export const EVAL_MAX_DIFF_BYTES = 200 * 1024;

/** Expectations are a small, hand-curated list per case, never a bulk import. */
export const EVAL_MAX_EXPECTATIONS_PER_CASE = 50;

/** Set-run history kept per agent (trend source before NFR-8 detail pruning). */
export const EVAL_MAX_HISTORY_RUNS = 100;

/** Points rendered on the metric trend (AC-26). */
export const EVAL_MAX_TREND_POINTS = 30;

/** Rows on the cross-agent "recent runs" dashboard list (AC-42). */
export const EVAL_MAX_RECENT_RUNS = 20;

/** Per-case detail (`eval_runs` rows) kept before NFR-8 pruning collapses it. */
export const EVAL_DETAIL_RETENTION_RUNS = 20;

/** NFR-2: a single case must not hang a run forever. */
export const EVAL_CASE_TIMEOUT_MS = 120_000;

/** NFR-2: a whole set run's outer budget — past this, a still-`running` DB row
 *  is read as `incomplete` rather than trusted (a crashed process can't
 *  deadlock an agent's lock forever). */
export const EVAL_RUN_TIMEOUT_MS = 20 * 60_000;

/** NFR-7: at most this many agents may have a set run in flight at once. */
export const EVAL_MAX_CONCURRENT_AGENTS = 3;

/**
 * Fixed task-framing line for an eval case's review (the `task` prompt slot).
 * Deliberately generic — an eval case is a frozen single-file fixture, not a
 * real PR, so it names neither a PR number nor a title.
 */
export const EVAL_TASK_LINE =
  'Review this change. Report only the distinct, high-value findings you can defend, ' +
  'each citing an exact file and line range that appears in the diff. There is no ' +
  'target or maximum count, and zero findings is a valid result.';
