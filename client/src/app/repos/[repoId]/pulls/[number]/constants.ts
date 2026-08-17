import type { IconName } from "@devdigest/ui";
import type { BriefRiskLevel } from "@devdigest/shared";

/**
 * Colours for a brief's `risk_level` / a risk's `severity` (AC-28: a text
 * label as well as a colour, never colour alone). Same ramp `SEV` uses for
 * CRITICAL/WARNING — high and medium map onto it directly; low borrows the
 * SUGGESTION/`--sugg` tone rather than inventing a fourth colour token.
 *
 * Route-root, not component-local: two consumers as of the Overview tab
 * layout revision (SPEC-03) — `BriefBar` for `brief.risk_level`, `IntentCard`
 * for each `risk.severity` — which is exactly why it moved here rather than
 * staying local to one component.
 */
export const RISK_COLOR: Record<BriefRiskLevel, { c: string; bg: string; icon: IconName }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { c: "var(--sugg)", bg: "var(--sugg-bg)", icon: "Info" },
};
