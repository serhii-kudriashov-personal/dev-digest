import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 650 } satisfies CSSProperties,
  subtitle: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: `1px solid ${current ? "var(--accent)" : "var(--border)"}`,
    background: current ? "var(--accent-bg)" : "var(--bg-surface)",
  }),
  rowText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  message: { fontSize: 13, fontWeight: 550 } satisfies CSSProperties,
  noMessage: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  date: { fontSize: 11, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  diffBox: {
    marginTop: 4,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  diffHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  diffStat: { marginLeft: "auto", fontSize: 11 } satisfies CSSProperties,
  diffBody: {
    maxHeight: 380,
    overflow: "auto",
    padding: "8px 0",
    fontSize: 12.5,
    lineHeight: "19px",
  } satisfies CSSProperties,
  diffLine: (op: "same" | "add" | "del"): CSSProperties => ({
    display: "flex",
    gap: 8,
    padding: "0 12px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background:
      op === "add" ? "var(--code-add)" : op === "del" ? "var(--code-del)" : "transparent",
    color:
      op === "add"
        ? "var(--code-add-text)"
        : op === "del"
          ? "var(--code-del-text)"
          : "var(--text-secondary)",
  }),
  diffSign: { width: 8, flexShrink: 0, userSelect: "none" } satisfies CSSProperties,
} as const;
