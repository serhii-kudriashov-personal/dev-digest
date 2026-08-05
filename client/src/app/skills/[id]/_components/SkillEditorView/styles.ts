import type { CSSProperties } from "react";

/** Co-located styles for SkillEditorView (the detail pane). */
export const s = {
  pane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  loading: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  headerIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  title: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto" } satisfies CSSProperties,
  tabsBar: {
    borderBottom: "1px solid var(--border)",
    marginTop: 14,
    flexShrink: 0,
  } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px 36px" } satisfies CSSProperties,
} as const;
