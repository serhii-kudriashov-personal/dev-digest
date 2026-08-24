import type { CSSProperties } from "react";

export const s = {
  cell: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  track: {
    flex: "0 0 64px",
    height: 6,
    borderRadius: 999,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  fill: { display: "block", height: "100%", borderRadius: 999 } satisfies CSSProperties,
  value: { fontSize: 12.5, color: "var(--text-secondary)", minWidth: 30 } satisfies CSSProperties,
} as const;
