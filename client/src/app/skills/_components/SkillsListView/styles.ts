import type { CSSProperties } from "react";
import { RAIL_WIDTH } from "../../constants";

/**
 * Co-located styles for SkillsListView. Mirrors AgentEditorView's rail/pane shape
 * so the two Skills-Lab screens read as one layout rather than two designs.
 */
export const s = {
  layout: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  railHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  railHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  railTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 12,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
    minWidth: 0,
  } satisfies CSSProperties,
  railList: {
    flex: 1,
    overflow: "auto",
    padding: "0 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  detailPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  emptyPane: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  } satisfies CSSProperties,
} as const;
