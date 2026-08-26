/**
 * Colours for the DETERMINISTIC confidence tier.
 *
 * Local to this component — one consumer, so no shared home (promotion happens
 * when a second consumer actually appears). The tiers mirror the server's
 * `deterministicConfidence`, which grades how well DOCUMENTED the PR was, not
 * how sure the model felt.
 */
export const CONFIDENCE_COLOR: Record<"high" | "medium" | "low", { c: string; bg: string }> = {
  high: { c: "var(--sugg)", bg: "var(--sugg-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low: { c: "var(--text-tertiary)", bg: "var(--bg-hover)" },
};
