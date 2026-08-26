import type { CSSProperties } from "react";

export const s = {
  page: { padding: 28, maxWidth: 1100 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, margin: 0, lineHeight: 1.25 } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "8px 0 0",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  scanMeta: { fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  toolbarCount: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  toolbarSpacer: { marginLeft: "auto" } satisfies CSSProperties,
  errorWrap: { marginBottom: 18 } satisfies CSSProperties,
  skeletonStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  candidateCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 12,
  } satisfies CSSProperties,
} as const;
