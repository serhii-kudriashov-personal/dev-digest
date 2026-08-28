/** Constants for the multi-agent review route (SPEC-05). */

/**
 * Results display mode, declared exactly once. A second copy of this
 * allowlist would silently swallow any mode added later — the URL would
 * change but the pane would not (`client/INSIGHTS.md` 2026-08-16).
 */
export const VIEW_MODES = ["columns", "tabs"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const DEFAULT_MODE: ViewMode = "columns";

/** `?pr=&run=&mode=&trace=&agent=&new=` — every search param this screen owns
 *  (Q4). `MultiAgentView` is the only component that reads or writes any of
 *  these. */
export const PR_PARAM = "pr";
export const RUN_PARAM = "run";
export const MODE_PARAM = "mode";
export const TRACE_PARAM = "trace";
export const AGENT_PARAM = "agent";
/** Forces the Configure-run panel even though the chosen PR already has a
 *  retrievable run — the "Start new review" affordance. Without this, a PR
 *  with a past run can never reach Configure again: `runs?.[0]` always wins. */
export const NEW_PARAM = "new";
