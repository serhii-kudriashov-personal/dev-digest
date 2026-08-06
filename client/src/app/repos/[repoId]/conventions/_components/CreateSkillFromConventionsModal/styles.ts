import type { CSSProperties } from "react";

export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--accent-border, var(--border))",
    background: "var(--accent-bg)",
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    marginBottom: 20,
  } satisfies CSSProperties,
  bannerIcon: { flexShrink: 0, marginTop: 2, color: "var(--accent)" } satisfies CSSProperties,
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
