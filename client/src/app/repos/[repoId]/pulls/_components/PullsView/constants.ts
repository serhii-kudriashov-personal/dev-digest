/** Constants for PullsView. Screen-wide list constants (columns, filter chips,
    status colours) are shared with PRRow/FilterBar and live in the route's own
    `../../constants`. */

/** Open PRs carry a derived review status; everything else is merged/closed. */
export const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);

/** Default status filter — the most actionable one on open. */
export const DEFAULT_STATUS = "needs_review";
