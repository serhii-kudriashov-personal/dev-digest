/** Constants for StatsTab. */

/**
 * Colour per finding category. Keys are the `FindingCategory` enum values
 * (`bug | security | perf | style | test`), mapped onto the severity palette
 * already in `vendor/ui/styles.css` so the chart matches the rest of the app.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "var(--accent)",
  style: "var(--info)",
  test: "var(--ok)",
};
