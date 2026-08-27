import type { CSSProperties } from "react";
import { LANE_MIN_WIDTH } from "./constants";

/** Co-located styles for MultiAgentResults. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  prBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: -4,
  } satisfies CSSProperties,
  prBadgeLink: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  meta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  metaIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  banner: (color: string, bg: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color,
    background: bg,
    borderRadius: 8,
    padding: "8px 12px",
  }),
  /** Columns mode stays a SINGLE row — past three or so lanes this scrolls
   *  horizontally rather than wrapping a 4th/5th lane onto a second row,
   *  which made it hard to compare every agent side by side at a glance. */
  grid: {
    display: "flex",
    gap: 14,
    alignItems: "stretch",
    overflowX: "auto",
    paddingBottom: 6,
  } satisfies CSSProperties,
  laneWrap: {
    flex: `0 0 ${LANE_MIN_WIDTH}px`,
    minWidth: LANE_MIN_WIDTH,
  } satisfies CSSProperties,
  skeletonWrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
