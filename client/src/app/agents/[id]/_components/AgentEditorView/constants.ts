/** Constants for AgentEditorView. */

import { TABS } from "../AgentEditor";

/**
 * Tabs the editor knows about; anything else in `?tab=` falls back to the first.
 * Derived from the tab bar's own list — a hand-kept second copy silently
 * swallows every tab added to `AgentEditor` but not to this array, which is
 * exactly how `context` shipped unreachable. Mirrors `SkillEditorView`.
 */
export const VALID_TABS = TABS.map((t) => t.key);

/** Fallback tab for a missing or unknown `?tab=`. */
export const DEFAULT_TAB = "config";

/** Width of the left agent rail, in px. */
export const RAIL_WIDTH = 280;
