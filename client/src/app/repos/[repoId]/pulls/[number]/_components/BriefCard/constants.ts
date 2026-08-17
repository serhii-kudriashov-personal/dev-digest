import type { IconName } from "@devdigest/ui";
import type { BriefRiskLevel } from "@devdigest/shared";

/**
 * Colours for the brief's `risk_level` (AC-28: a text label as well as a
 * colour, never colour alone). Same ramp `SEV` uses for CRITICAL/WARNING —
 * high and medium map onto it directly; low borrows the SUGGESTION/`--sugg`
 * tone rather than inventing a fourth colour token.
 *
 * Local to this component — one consumer, promotion happens if a second ever
 * appears, same reasoning as `IntentCard/constants.ts#CONFIDENCE_COLOR`.
 */
export const RISK_COLOR: Record<BriefRiskLevel, { c: string; bg: string; icon: IconName }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { c: "var(--sugg)", bg: "var(--sugg-bg)", icon: "Info" },
};
