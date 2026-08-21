/** Shared color-by-metric convention for eval metrics — recall, precision and
 *  citation accuracy each keep the same color everywhere they're rendered
 *  (the agent Evals tab and the cross-agent Eval Dashboard). `precision` has
 *  no dedicated CSS token, so it falls back inline like `directionUp` does. */
export const EVAL_METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--good, #22c55e)",
  citation: "var(--warn)",
} as const;
