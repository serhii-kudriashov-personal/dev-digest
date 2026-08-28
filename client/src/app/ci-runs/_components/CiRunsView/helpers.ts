import type { CiRun } from "@devdigest/shared";

/**
 * `cost_usd == null` renders `dash` — the digit `0` must never appear in the
 * cost cell (AC-30; root `INSIGHTS.md` 2026-08-02: unknown cost is `null`,
 * never `0`).
 */
export function formatCiCost(value: number | null | undefined, dash: string): string {
  if (value === null || value === undefined) return dash;
  return `$${value.toFixed(2)}`;
}

/** `duration_s` has no server-side producer yet — always renders `dash`. */
export function formatCiDuration(seconds: number | null | undefined, dash: string): string {
  if (seconds === null || seconds === undefined) return dash;
  return `${seconds.toFixed(1)}s`;
}

/**
 * The pull request GitHub link — built from `repo` (the installation's
 * repository, joined in server-side) and `pr_number`. `null` when either is
 * missing, e.g. a run GitHub could not attribute to a pull request.
 */
export function ciRunPrUrl(run: CiRun): string | null {
  if (!run.repo || run.pr_number == null) return null;
  return `https://github.com/${run.repo}/pull/${run.pr_number}`;
}

/**
 * `findings_count === null` is EXACTLY "no artifact was accepted for this
 * run" (`toRunRecord`, `server/src/modules/ci/helpers.ts`) — true whether the
 * underlying GitHub run is still in progress or has already failed. AC-28
 * collapses both to one "no result yet" state; DevDigest does not attempt to
 * distinguish or explain the cause, the job link carries that.
 */
export function hasNoResultYet(run: CiRun): boolean {
  return run.findings_count === null || run.findings_count === undefined;
}
