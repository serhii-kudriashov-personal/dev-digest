import type { Severity } from "@devdigest/shared";

/**
 * Delay before a hover opens the card (and, where the caller fetches lazily,
 * triggers its request).
 *
 * Without it, dragging the pointer across a table flashes a card over every row
 * it crosses and fires one request per row. 220ms is long enough that a
 * pass-through costs nothing and short enough that a deliberate hover feels
 * immediate.
 */
export const HOVER_OPEN_DELAY_MS = 220;

/** Card box. The height cap turns a 20-finding PR into a scroll, not a wall. */
export const POPOVER_WIDTH = 470;
export const POPOVER_MAX_HEIGHT = 440;

/** Gap between the anchor and the card edge. */
export const POPOVER_OFFSET = 8;

/**
 * Severity order, worst first — both the badge order and the card's sort.
 *
 * The order is a property of how findings are ranked, not of the screen
 * rendering them, so the two sites that show a breakdown share this one rather
 * than each keeping a copy. (`FindingsPanel/constants.ts` still keeps its own
 * `SEVERITY_ORDER` weight map, which carries a fourth level, `INFO`, that the
 * contract's `Severity` does not — see the spec's open questions.)
 */
export const SEVERITY_ORDER: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
