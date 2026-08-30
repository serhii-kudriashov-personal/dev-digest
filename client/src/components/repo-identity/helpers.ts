import { MAX_PATH_SEGMENTS } from "./constants";

export interface NamespaceView {
  /** The segments that stay on screen, already joined with "/". */
  shown: string;
  /** True when segments were dropped from the FRONT of the path. */
  truncated: boolean;
}

/**
 * Shorten a namespace path from the FRONT, keeping the project and its nearest
 * groups (AC-33).
 *
 * `group/subgroup/team/project` becomes `subgroup/team/project`: the tail is
 * what distinguishes one project from another, while the head is shared by
 * every project in the group. A path already short enough is returned unchanged
 * and reports `truncated: false`, so no caller renders an expand control that
 * would do nothing.
 */
export function truncateNamespace(
  path: string,
  maxSegments: number = MAX_PATH_SEGMENTS,
): NamespaceView {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= maxSegments) return { shown: segments.join("/"), truncated: false };
  return { shown: segments.slice(segments.length - maxSegments).join("/"), truncated: true };
}
