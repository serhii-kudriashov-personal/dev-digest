import type { AgentHistoryRow } from "@devdigest/shared";

/** localStorage key remembering the last PR viewed on this repo's
 *  Multi-Agent Review screen (US-6) — the same `dd-<thing>` convention as
 *  `dd-repo`/`dd-theme` in `client/src/lib/repo-context.tsx`. Lets a
 *  PR-less entry point (the left-nav "Multi-Agent Review" item) reopen the
 *  last run instead of always landing on an empty Configure screen. */
export function lastPrStorageKey(repoId: string): string {
  return `dd-multiagent-pr-${repoId}`;
}

export interface RunEstimate {
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * Pure — the Configure-run screen's pre-run estimate over the SELECTED
 * agents' most recent completed runs (AC-12).
 *
 * Duration is the SUM of the selected agents' last known durations, because
 * the executor runs them one after another rather than concurrently
 * (AC-14, verified against `run-executor.ts:150-184`'s sequential
 * `for … await` — never described as parallel anywhere on this screen).
 *
 * Both totals sum only the KNOWN values and read `null` — never `0` — when
 * none of the selected agents has one (root `INSIGHTS.md` 2026-08-02);
 * `null` cost with at least one selected agent is exactly AC-13's "every
 * selected agent's cost is unknown" case.
 */
export function estimate(selectedIds: string[], history: AgentHistoryRow[]): RunEstimate {
  const lastRuns = selectedIds.map(
    (id) => history.find((h) => h.agent_id === id)?.last_run ?? null,
  );

  const durations = lastRuns
    .map((r) => r?.duration_ms)
    .filter((d): d is number => d != null);
  const durationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;

  const costs = lastRuns.map((r) => r?.cost_usd).filter((c): c is number => c != null);
  const costUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;

  return { durationMs, costUsd };
}
