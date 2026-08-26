import type { CSSProperties } from "react";

/** Co-located styles for the SmartDiffViewer. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  groupTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  groupSubtitle: { fontSize: 12, color: "var(--text-muted)", flex: 1, minWidth: 0 } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  fileRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  fileCardWrap: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  findingsBtn: {
    background: "var(--crit-bg)",
    color: "var(--crit)",
    borderStyle: "none",
    borderRadius: 5,
    padding: "3px 9px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  empty: { fontSize: 12, color: "var(--text-muted)", paddingLeft: 20 } satisfies CSSProperties,
} as const;

/** The little colour square that identifies a group. */
export function squareFor(color: string): CSSProperties {
  return { width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 };
}
