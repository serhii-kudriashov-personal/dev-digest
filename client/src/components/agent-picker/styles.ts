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
  card: (accent: string, checked: boolean): CSSProperties => ({
    display: "block",
    borderRadius: 8,
    border: `1px solid ${checked ? accent : "var(--border)"}`,
    background: checked ? "var(--bg-elevated)" : "transparent",
    padding: "10px 12px",
  }),
  labelRow: { display: "flex", alignItems: "center", gap: 10, width: "100%" } satisfies CSSProperties,
  iconBadge: (accent: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 7,
    background: accent,
    color: "#fff",
    flexShrink: 0,
  }),
  cardBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 } satisfies CSSProperties,
  cardNameRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  cardName: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  cardSummary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  cardStats: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
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
