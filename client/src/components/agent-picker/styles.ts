import type { CSSProperties } from "react";
import { LIST_MAX_HEIGHT } from "./constants";

/** Co-located styles for AgentPicker. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 240,
  } satisfies CSSProperties,
  mergedBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 6,
    padding: "6px 8px",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  countLabel: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  selectAllBtn: {
    background: "transparent",
    border: "none",
    padding: 0,
    fontSize: 12.5,
    fontWeight: 500,
    color: "var(--accent)",
    cursor: "pointer",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: "none",
    maxHeight: LIST_MAX_HEIGHT,
    overflowY: "auto",
  } satisfies CSSProperties,
  disabledTag: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderTop: "1px solid var(--border)",
    paddingTop: 10,
  } satisfies CSSProperties,
  configureLink: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
