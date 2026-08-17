import type { CSSProperties } from "react";

export const s = {
  // `auto-fit` rather than `1fr 1fr`: it collapses to one column on a narrow
  // viewport, and it lets the surviving card expand when `BlastRadiusCard`
  // returns null (`loading || !blast`) or `IntentCard` returns null
  // (`loading`) — neither card's internals need to change for that. Precedent:
  // `client/src/app/skills/[id]/_components/StatsTab/styles.ts`.
  summaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
