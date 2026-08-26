import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  } satisfies CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  intent: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  lists: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    marginTop: 14,
  } satisfies CSSProperties,
  listCol: {
    flex: "1 1 240px",
    minWidth: 200,
  } satisfies CSSProperties,
  listTitle: {
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-tertiary)",
    marginBottom: 6,
  } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  meta: {
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-tertiary)",
  } satisfies CSSProperties,
} as const;
