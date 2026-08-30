import type { CSSProperties } from "react";

/** Co-located styles for RepoIdentity. */
export const s = {
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  path: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  expand: {
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    borderRadius: 5,
    fontSize: 11,
    lineHeight: 1,
    padding: "2px 5px",
    cursor: "pointer",
  } satisfies CSSProperties,
  instance: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
