import type { CSSProperties } from "react";

/** Co-located styles for DocumentList. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-surface)",
    padding: 10,
  } satisfies CSSProperties,
  heading: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "2px 4px 6px",
  } satisfies CSSProperties,
  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 5,
    width: "100%",
    textAlign: "left",
    padding: "9px 10px",
    borderRadius: 7,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
    cursor: "pointer",
    color: "var(--text-primary)",
  }),
  path: { fontSize: 12.5, fontWeight: 550, wordBreak: "break-all" } satisfies CSSProperties,
  dir: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  badges: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 } satisfies CSSProperties,
} as const;
