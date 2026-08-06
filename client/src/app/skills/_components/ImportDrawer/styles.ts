import type { CSSProperties } from "react";

/** Co-located styles for ImportDrawer. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  picker: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 9,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  pickerText: { flex: 1, fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  filename: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  hiddenInput: { display: "none" } satisfies CSSProperties,
  error: {
    fontSize: 12,
    color: "var(--crit)",
    padding: "8px 12px",
    borderRadius: 7,
    background: "var(--crit-bg)",
  } satisfies CSSProperties,
  notice: {
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    padding: "10px 12px",
    borderRadius: 7,
    background: "var(--warn-bg)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  ignoredBox: {
    padding: "10px 12px",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  ignoredTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  ignoredList: {
    margin: 0,
    paddingLeft: 16,
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;
