import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 860 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 650 } satisfies CSSProperties,
  subtitle: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  box: {
    marginTop: 6,
    padding: "18px 22px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13.5,
  } satisfies CSSProperties,
} as const;
