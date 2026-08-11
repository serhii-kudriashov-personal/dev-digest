import type { CSSProperties } from "react";

/** Styles for the Blast Radius card. Same shell as `IntentCard`'s, on purpose:
    the two sit next to each other on the Overview tab. */
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
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  } satisfies CSSProperties,
  stats: {
    display: "flex",
    gap: 18,
    flexWrap: "wrap",
    marginBottom: 12,
  } satisfies CSSProperties,
  stat: {
    display: "flex",
    alignItems: "baseline",
    gap: 5,
  } satisfies CSSProperties,
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    marginBottom: 12,
  } satisfies CSSProperties,
  reason: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 12,
  } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  node: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  nodeHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "var(--bg-hover)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  nodeSymbol: {
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  nodeFile: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  nodeSpacer: { flex: 1 } satisfies CSSProperties,
  nodeBody: {
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  callerRow: {
    display: "block",
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    color: "var(--accent)",
    background: "none",
    border: "none",
    padding: "2px 0",
    cursor: "pointer",
    textAlign: "left",
    textDecoration: "none",
  } satisfies CSSProperties,
  callerPlain: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    color: "var(--text-muted)",
    padding: "2px 0",
  } satisfies CSSProperties,
  facts: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  graphWrap: {
    overflowX: "auto",
  } satisfies CSSProperties,
  graphLabel: {
    fontSize: 11,
    fill: "var(--text-secondary)",
  } satisfies CSSProperties,
  graphLabelStrong: {
    fontSize: 11,
    fontWeight: 700,
    fill: "var(--text-primary)",
  } satisfies CSSProperties,
  graphEdge: {
    stroke: "var(--border)",
    strokeWidth: 1,
  } satisfies CSSProperties,
  graphEmpty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
