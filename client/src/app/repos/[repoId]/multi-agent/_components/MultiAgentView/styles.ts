import type { CSSProperties } from "react";

/** Co-located styles for MultiAgentView. */
export const s = {
  page: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  noRunBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    borderRadius: 8,
    padding: "10px 14px",
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  backLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent)",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  } satisfies CSSProperties,
} as const;
