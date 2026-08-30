import type { CSSProperties } from "react";

/** Co-located styles for InstancesSection and its InstanceRow. */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  count: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 12,
  } satisfies CSSProperties,
  form: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    marginBottom: 24,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  formActions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  rowLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rowBase: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  rowActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  capability: (capability: string): CSSProperties => ({
    fontSize: 12,
    // Colour is decoration only — the state is always spelled out in words, so
    // an "unknown" capability can never read as "unavailable" (AC-8, AC-9).
    color:
      capability === "permitted"
        ? "var(--ok)"
        : capability === "refused"
          ? "var(--crit)"
          : "var(--text-muted)",
  }),
  result: (ok: boolean): CSSProperties => ({
    marginTop: 10,
    fontSize: 13,
    fontWeight: 600,
    color: ok ? "var(--ok)" : "var(--crit)",
  }),
  error: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--crit)",
  } satisfies CSSProperties,
} as const;
