/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/**
 * The DOM id of one rendered diff line — ONE definition, shared by the element
 * that carries the id and by whatever scrolls to it. Two copies of this rule
 * drift silently: the anchor still renders and the scroll simply does nothing.
 *
 * Everything outside `[A-Za-z0-9]` is replaced, so a path is never able to put
 * a selector metacharacter (or anything else) into a DOM id.
 */
export function lineAnchorId(path: string, line: number): string {
  return `diff-${path.replace(/[^a-zA-Z0-9]/g, "-")}-L${line}`;
}

/**
 * The DOM id of one file card's heading — the element `useDiffLineTarget`
 * moves focus to after scrolling (`plans/2026-08-16-pr-why-risk-brief.md`
 * Step 10). Same replacement rule as `lineAnchorId`, so the two ids never
 * collide for the same path.
 */
export function fileHeadingId(path: string): string {
  return `diff-heading-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}
