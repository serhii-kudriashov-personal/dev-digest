import type { CSSProperties } from "react";
import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH } from "./constants";

/** Co-located styles for the findings hover card and its anchor. */
export const s = {
  /** The anchor owns the hover, so give it something to hover even when the
   *  badges inside it are narrow. */
  anchor: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
    alignSelf: "stretch",
  } satisfies CSSProperties,
  /**
   * `position: fixed` rather than absolute: the PR list's table card sets
   * `overflow: hidden` for its rounded corners, which would clip an absolutely
   * positioned child on the lower rows — and the review accordion does the same.
   * The card stays a DOM DESCENDANT of the anchor so moving the pointer into it
   * does not count as leaving the anchor.
   */
  popover: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    overflowY: "auto",
    zIndex: 40,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    boxShadow: "0 12px 32px rgba(0,0,0,.45)",
    padding: "12px 14px",
    cursor: "default",
    // The card is read-only; text inside it is normal-cased even when the
    // anchor sits in an uppercased header.
    textTransform: "none",
    letterSpacing: "normal",
  }),
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    paddingBottom: 10,
  } satisfies CSSProperties,
  item: (first: boolean): CSSProperties => ({
    padding: "10px 0",
    borderTop: first ? "none" : "1px solid var(--border)",
  }),
  itemHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  itemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  itemMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 5,
  } satisfies CSSProperties,
  itemFile: {
    fontSize: 12,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  itemRationale: {
    marginTop: 5,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
  state: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: "4px 0 2px",
  } satisfies CSSProperties,
} as const;
