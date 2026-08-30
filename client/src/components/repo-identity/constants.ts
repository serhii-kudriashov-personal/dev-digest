/**
 * How many trailing namespace segments stay visible before the path is
 * truncated from the FRONT (AC-33).
 *
 * Three keeps the project and its two nearest groups — `…/team/project` reads
 * as a location, while `acme/…` reads as an owner and tells you nothing about
 * which of a group's forty projects this is. A GitHub `owner/repo` is two
 * segments, so it is never truncated and nothing about the pre-feature screens
 * changes (AC-19).
 */
export const MAX_PATH_SEGMENTS = 3;

/** Marker prefixed to a front-truncated path. */
export const TRUNCATION_MARK = "…/";
