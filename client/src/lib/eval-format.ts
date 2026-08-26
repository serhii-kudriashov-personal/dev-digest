/* lib/eval-format.ts — shared formatting for eval metrics/cost (L06, SPEC-04).
   Promoted here (rather than living in one screen's helpers.ts) because BOTH
   the agent Evals tab and the cross-agent Eval Dashboard need it — the second
   real consumer is what earns a shared home (frontend-ui-architecture §2). */

/** A metric may be `null` (unknown) — render the catalogue's dash, never `0`
 *  (AC-23, AC-31). */
export function formatPct(value: number | null, dash: string): string {
  if (value === null) return dash;
  return `${Math.round(value * 100)}%`;
}

export function formatCost(value: number | null, dash: string): string {
  if (value === null) return dash;
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number | null, dash: string): string {
  if (ms === null) return dash;
  return `${(ms / 1000).toFixed(1)}s`;
}
