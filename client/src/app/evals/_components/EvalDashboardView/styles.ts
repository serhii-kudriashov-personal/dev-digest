import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  alert: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "6px 8px",
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  neverRunBadge: {
    fontSize: 11,
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 6px",
  } satisfies CSSProperties,
  direction: {
    up: { color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
    down: { color: "var(--crit)", display: "inline-flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
    flat: { color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
  },
} as const;
