import type { CSSProperties } from "react";

/** Co-located styles for DisagreementPanel. */
export const s = {
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  title: { fontWeight: 600, fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  body: { padding: 14, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  emptyNote: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  location: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
  } satisfies CSSProperties,
  locationHeader: { marginBottom: 8 } satisfies CSSProperties,
  stanceRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    padding: "3px 0",
  } satisfies CSSProperties,
  stanceAgent: { color: "var(--text-primary)", fontWeight: 500, minWidth: 120 } satisfies CSSProperties,
  didNotFlag: { color: "var(--text-muted)" } satisfies CSSProperties,
  capsNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
