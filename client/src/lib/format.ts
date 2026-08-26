/* Shared display formatters used across route trees (so they can't live in any
   one page's local helpers.ts). */

/**
 * USD cost for display.
 *
 * Precision widens as the value shrinks so ~3 significant digits survive at
 * every magnitude a review run realistically lands on. A fixed precision would
 * either round sub-cent runs to "$0.00" — the one output this feature must
 * never produce — or make the PR-list column needlessly noisy.
 *
 * null/undefined means UNKNOWN (a failed run, or a row that pre-dates the L01
 * cost restore) and renders as an em dash. A genuine 0 renders "$0.0000",
 * which is honest: the run really did cost nothing.
 */
export function formatCost(cost: number | null | undefined): string {
  if (cost == null || Number.isNaN(cost)) return "—";
  if (cost >= 1) return `$${cost.toFixed(2)}`; // $1.24
  if (cost >= 0.01) return `$${cost.toFixed(3)}`; // $0.014
  return `$${cost.toFixed(4)}`; // $0.0013
}

/** Compact token count for the timeline row, e.g. "9,119 tok". */
export function formatTokenCount(tokens: number | null | undefined): string | null {
  if (tokens == null || tokens <= 0) return null;
  return `${tokens.toLocaleString("en-US")} tok`;
}

/**
 * A 0..1 rate as a whole percentage, or an em dash when there is nothing to
 * measure yet.
 *
 * `null` and `0` are different facts and must render differently: a skill nobody
 * has judged has NO accept rate, while a skill whose findings were all dismissed
 * genuinely has 0%. Same rule the cost badge follows for unknown vs free.
 */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}
