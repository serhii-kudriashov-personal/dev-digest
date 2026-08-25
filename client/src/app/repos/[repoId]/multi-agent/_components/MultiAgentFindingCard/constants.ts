/** Constants for MultiAgentFindingCard. Duplicated from
 *  `pulls/[number]/_components/FindingCard/constants.ts` — a cross-route
 *  `../../../` import is a boundary violation, and this is two lines
 *  (`frontend-ui-architecture` §2, duplication over the wrong abstraction). */

/** Severity → CSS colour token, for the card's left-border tint. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
