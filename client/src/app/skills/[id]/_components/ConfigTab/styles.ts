import type { CSSProperties } from "react";

/** Co-located styles for the skill ConfigTab. */
export const s = {
  form: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 650, flex: 1 } satisfies CSSProperties,
  enabledLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  severityHint: {
    fontSize: 11.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 } satisfies CSSProperties,
  savedNote: { fontSize: 12, color: "var(--ok)" } satisfies CSSProperties,
  // Destructive action sits apart from Save, at the far end of the row.
  deleteBtn: { marginLeft: "auto", color: "var(--crit)" } satisfies CSSProperties,
} as const;
