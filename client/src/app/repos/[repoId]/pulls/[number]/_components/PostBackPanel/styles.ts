import type { CSSProperties } from "react";

/** Co-located styles for PostBackPanel. Same visual vocabulary as VerdictBanner
 *  (icon box + label + body), one step smaller: this sits under it, not beside it. */
export const s = {
  wrap: {
    marginTop: 16,
    padding: "14px 16px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  outcome: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  iconBox: (bg: string, color: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  body: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  label: (color: string): CSSProperties => ({ fontSize: 14, fontWeight: 600, color }),
  reason: {
    margin: "6px 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  meta: {
    display: "block",
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
