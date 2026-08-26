import type { CSSProperties } from "react";
import { RAIL_WIDTH } from "./constants";

/** Co-located styles for AgentEditorView (extracted from inline styles). */
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
    marginBottom: 14,
  } satisfies CSSProperties,
  railTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  railList: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  loadingPane: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  editorPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  editorIcon: { color: "var(--accent)" } satisfies CSSProperties,
  editorTitle: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  editorHeaderActions: { marginLeft: "auto" } satisfies CSSProperties,
  editorBody: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
} as const;
