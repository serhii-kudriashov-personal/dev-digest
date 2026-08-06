import type { CSSProperties } from "react";
import type { ConventionStatus } from "@devdigest/shared";

/** Co-located styles for ConventionCard. */
export const s = {
  // A rejected card stays visible and dims. Hiding it would make the rejection
  // impossible to take back.
  card: (status: ConventionStatus): CSSProperties => ({
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${
      status === "accepted"
        ? "var(--ok)"
        : status === "rejected"
          ? "var(--border)"
          : "var(--accent)"
    }`,
    background: "var(--bg-surface)",
    opacity: status === "rejected" ? 0.5 : 1,
    marginBottom: 12,
  }),
  row: { display: "flex", gap: 16, alignItems: "flex-start" } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  ruleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  } satisfies CSSProperties,
  rule: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
    fontStyle: "italic",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  editRow: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 } satisfies CSSProperties,
  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  } satisfies CSSProperties,
  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
    marginBottom: 12,
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  // Same size as MonoLink, but muted — it is a reference, not an affordance.
  evidencePath: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  copyIcon: {
    marginLeft: "auto",
    cursor: "pointer",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.5,
    background: "var(--code-bg)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  confidenceRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  confidenceLabel: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { width: 90, flexShrink: 0 } satisfies CSSProperties,
  confidenceValue: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  actionCol: {
    width: 150,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
} as const;
