/** Constants for the DiffViewer. */
import type { Severity } from "@devdigest/shared";

/** Files with this many or fewer changed lines start expanded. */
export const AUTO_EXPAND_MAX_LINES = 200;

/** Matches a unified-diff hunk header, e.g. `@@ -1,2 +1,3 @@`. */
export const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// ---- Findings overlay -----------------------------------------------------

/** The prefixes a unified diff puts in front of a path (`./`, `a/`, `b/`). */
export const FINDING_PATH_PREFIX_RE = /^(\.\/|a\/|b\/)+/;

/** Lower is more serious — used to pick which finding tints a covered line. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/**
 * Left-border colour per severity, reusing the same CSS vars `SeverityBadge`
 * does so a line and its chip can never disagree. No colour literal is invented
 * outside this file.
 */
export const SEVERITY_BORDER_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};
