import type { SkillType } from "@devdigest/shared";

/**
 * Route-level constants for /skills.
 *
 * Shared by the list view, the import drawer and the editor, so they live at the
 * route root rather than inside one component's folder (see client/INSIGHTS.md
 * 2026-08-03 — extracting a view does not move the route's shared constants).
 */

/** Every skill type, in the order the editor's select offers them. */
export const SKILL_TYPE_VALUES: readonly SkillType[] = [
  "rubric",
  "convention",
  "security",
  "custom",
] as const;

/** Width of the library rail, in px. Matches the Agents editor's rail. */
export const RAIL_WIDTH = 300;

/**
 * How many characters approximate one token.
 *
 * Same divisor the server ships as `approxTokens`, so the editor's estimate and
 * the server's fallback agree. The trace's `token_counts` remains the real
 * tiktoken figure — this one is rendered with a `~` because it is a guess.
 */
export const CHARS_PER_TOKEN = 4;

/** Debounce for the body editor's token estimate, in ms. */
export const TOKEN_ESTIMATE_DEBOUNCE_MS = 250;
