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

// `CHARS_PER_TOKEN` and `TOKEN_ESTIMATE_DEBOUNCE_MS` moved to
// `src/components/body-editor/constants.ts` when the editor was promoted out of
// this route — it is now shared with the conventions extractor's create-skill
// modal, and a shared component must not import a route's constants.
