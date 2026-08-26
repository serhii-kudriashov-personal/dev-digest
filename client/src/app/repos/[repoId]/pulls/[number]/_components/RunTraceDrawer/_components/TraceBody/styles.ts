import type { CSSProperties } from "react";

/** Styles local to TraceBody's project-context rows. */
export const s = {
  skippedWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  skipped: { fontSize: 12, color: "var(--warn)" } satisfies CSSProperties,
} as const;
