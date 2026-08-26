import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Presentation rules for the reviewer-ordered diff.
 *
 * Local to this component — one consumer, so no shared home. The server owns
 * the classification and the ORDER of the groups; this file only says what each
 * group looks like and whether it starts open.
 */

/** The colour of a group's square. Existing tokens only — no new literals. */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--crit)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-tertiary)",
};

/**
 * Whether a group's files may start expanded.
 *
 * `boilerplate: false` is absolute, not a default: a lock file stays collapsed
 * even when a review flagged a line in it. Skimming is the whole point of the
 * group, and 30 000 lines of generated YAML would bury everything above it.
 */
export const ROLE_DEFAULT_OPEN: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};
