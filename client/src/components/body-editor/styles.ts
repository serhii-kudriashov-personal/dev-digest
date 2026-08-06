import type { CSSProperties } from "react";

const MONO_LINE_HEIGHT = 20;
const MONO_FONT_SIZE = 12.5;

/** Co-located styles for BodyEditor. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  filename: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  tokens: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  // The gutter and the textarea share a line box, so their rows line up. Any
  // change to font-size or line-height must be made in BOTH.
  body: { display: "flex", alignItems: "stretch", maxHeight: 460 } satisfies CSSProperties,
  gutter: {
    flexShrink: 0,
    padding: "10px 8px 10px 12px",
    textAlign: "right",
    fontSize: MONO_FONT_SIZE,
    lineHeight: `${MONO_LINE_HEIGHT}px`,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    borderRight: "1px solid var(--border)",
    userSelect: "none",
    overflow: "hidden",
  } satisfies CSSProperties,
  textarea: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    fontSize: MONO_FONT_SIZE,
    lineHeight: `${MONO_LINE_HEIGHT}px`,
    border: "none",
    outline: "none",
    resize: "vertical",
    background: "transparent",
    color: "var(--text-primary)",
    // `pre` (not `pre-wrap`): a wrapped line would occupy two rows in the
    // textarea but one in the gutter, and the numbers would drift.
    whiteSpace: "pre",
    overflow: "auto",
    tabSize: 2,
  } satisfies CSSProperties,
} as const;

export const EDITOR_LINE_HEIGHT = MONO_LINE_HEIGHT;
