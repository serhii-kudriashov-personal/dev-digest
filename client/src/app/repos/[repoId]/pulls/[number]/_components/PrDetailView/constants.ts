/** Constants for PrDetailView. */

/** Default tab when `?tab=` is absent. */
export const DEFAULT_TAB = "overview";

/**
 * `?finding=<id>` — the finding to open on load. A severity chip in the diff
 * opens this page in a new browser tab, so the target has to survive a cold load.
 */
export const FINDING_PARAM = "finding";
