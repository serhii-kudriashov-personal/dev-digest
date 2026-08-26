import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 12,
    borderRadius: 9,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-bg)" : "var(--bg-surface)",
    // A disabled skill is dimmed, not hidden: it stays linked to its agents and
    // keeps its order, it just contributes nothing to the prompt.
    opacity: enabled ? 1 : 0.55,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  iconBox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 7,
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  description: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerStat: { color: "var(--text-muted)" } satisfies CSSProperties,
  // Only colour a rate that exists; an em dash stays muted rather than looking
  // like a bad score.
  footerAccept: (rate: number | null | undefined): CSSProperties => ({
    color:
      rate == null
        ? "var(--text-muted)"
        : rate >= 0.75
          ? "var(--ok)"
          : rate >= 0.5
            ? "var(--warn)"
            : "var(--crit)",
  }),
} as const;
