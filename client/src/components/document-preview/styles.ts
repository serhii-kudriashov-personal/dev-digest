import type { CSSProperties } from "react";

/** Co-located styles for DocumentPreview. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  path: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: "var(--text-primary)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  body: { padding: "14px 16px", fontSize: 13.5 } satisfies CSSProperties,
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 5,
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  placeholder: {
    display: "grid",
    placeItems: "center",
    minHeight: 180,
    border: "1px dashed var(--border-strong)",
    borderRadius: 9,
    fontSize: 12.5,
    color: "var(--text-muted)",
    padding: 20,
    textAlign: "center",
  } satisfies CSSProperties,
} as const;
