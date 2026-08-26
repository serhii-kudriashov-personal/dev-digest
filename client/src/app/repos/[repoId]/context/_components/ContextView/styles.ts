import type { CSSProperties } from "react";

/* Co-located styles for ContextView. Every custom property used here is one the
   design system actually declares (src/vendor/ui/styles.css) — an undefined one
   fails silently, with no typecheck, lint or test able to see it. */
export const s = {
  page: {
    padding: "24px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxWidth: 1180,
  } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 16 } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 19, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  subtitle: {
    marginTop: 4,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  summary: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  truncated: { fontSize: 12.5, color: "var(--warn)" } satisfies CSSProperties,
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 420px) 1fr",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  editInRepo: {
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
