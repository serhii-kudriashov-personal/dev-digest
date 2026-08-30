/** Default settings section when none is provided in the route. */
export const DEFAULT_SECTION = "api-keys";

/** Section keys that have a bespoke implemented panel. */
export const SECTION_API_KEYS = "api-keys";
export const SECTION_MODELS = "models";
export const SECTION_INSTANCES = "instances";

/**
 * Sections this route adds on top of the vendored `SETTINGS_SECTIONS` table.
 *
 * The vendored list is `src/vendor/ui/nav.ts`, which the repo rule says not to
 * refactor; a section owned by this feature is registered here instead, and the
 * view renders the two lists as one. The label is a message key rather than an
 * English literal, because the vendored entries predate the i18n catalogue and
 * new copy does not (`frontend-ui-architecture` §1).
 */
export const EXTRA_SECTIONS = [
  { key: SECTION_INSTANCES, labelKey: "instances.navLabel" },
] as const;
