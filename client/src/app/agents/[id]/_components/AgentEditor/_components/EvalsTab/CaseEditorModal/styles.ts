import type { CSSProperties } from "react";

export const s = {
  body: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: 20 } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } satisfies CSSProperties,
  tabsRow: { display: "flex", gap: 4 } satisfies CSSProperties,
  tabBtn: (active: boolean): CSSProperties => ({
    padding: "6px 10px",
    fontSize: 12.5,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: "pointer",
  }),
  filesList: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  validityRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 } satisfies CSSProperties,
  validOk: { color: "var(--accent)" } satisfies CSSProperties,
  validBad: { color: "var(--crit)" } satisfies CSSProperties,
  lastResultStrip: {
    fontSize: 12.5,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  errorBanner: {
    fontSize: 12.5,
    color: "var(--crit)",
    padding: "8px 10px",
    border: "1px solid var(--crit)",
    borderRadius: 6,
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerRight: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
