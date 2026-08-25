import type { CSSProperties } from "react";

/** Co-located styles for ConfigureRunPanel. */
export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    maxWidth: 520,
  } satisfies CSSProperties,
  prField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  label: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  agentBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  inert: {
    opacity: 0.5,
    pointerEvents: "none",
  } satisfies CSSProperties,
  inertNote: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  estimate: {
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    borderRadius: 8,
    padding: "8px 12px",
  } satisfies CSSProperties,
  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  historyRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "8px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  historyAgent: {
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  historyMeta: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  historySummary: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
