import type { BlastState } from "@devdigest/shared";

/** Literals for the Blast Radius card. Route-local, beside the one consumer. */

/** The two views the header toggle offers. */
export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

/**
 * Badge colours per non-`full` state, mirroring `IntentCard`'s inline `stale`
 * badge. `full` has no badge at all — that is what keeps "nothing downstream"
 * visually distinct from "the index could not answer".
 *
 * `--crit` / `--crit-bg` are the danger tokens this design system actually
 * defines (there is no `--danger`); both are declared for light and dark.
 */
export const STATE_BADGE: Record<
  Exclude<BlastState, "full">,
  { color: string; bg: string; icon: "AlertTriangle" | "AlertOctagon" }
> = {
  partial: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  degraded: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
};

/**
 * Graph caps. The SVG is drawn by hand (no charting dependency), so these bound
 * both the DOM node count and the vertical extent a reader has to scroll.
 */
export const GRAPH_MAX_SYMBOLS = 6;
export const GRAPH_MAX_CALLERS_PER_SYMBOL = 5;

/** Geometry of the two-column graph, in SVG user units. */
export const GRAPH_ROW_HEIGHT = 26;
export const GRAPH_LEFT_X = 8;
export const GRAPH_RIGHT_X = 300;
export const GRAPH_WIDTH = 620;
export const GRAPH_PADDING_Y = 14;
