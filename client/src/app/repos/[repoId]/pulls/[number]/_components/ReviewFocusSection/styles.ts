import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  note: {
    marginTop: 10,
    fontSize: 12.5,
    color: "var(--text-tertiary)",
  } satisfies CSSProperties,
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  focusRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    padding: "8px 0",
    background: "none",
    border: "none",
    borderTop: "1px solid var(--border)",
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
  } satisfies CSSProperties,
  focusPath: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    color: "var(--accent)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  } satisfies CSSProperties,
  focusReason: {
    fontSize: 12.5,
    color: "var(--text-tertiary)",
    whiteSpace: "normal",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
