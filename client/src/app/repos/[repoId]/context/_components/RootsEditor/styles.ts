import type { CSSProperties } from "react";

/** Co-located styles for RootsEditor. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  value: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 8 } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
} as const;
