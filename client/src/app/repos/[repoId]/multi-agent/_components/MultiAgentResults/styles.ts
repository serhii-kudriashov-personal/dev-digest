import type { CSSProperties } from "react";
import { LANE_MIN_WIDTH } from "./constants";

/** Co-located styles for MultiAgentResults. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  meta: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
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
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${LANE_MIN_WIDTH}px, 1fr))`,
    gap: 14,
    alignItems: "start",
  } satisfies CSSProperties,
  skeletonWrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
