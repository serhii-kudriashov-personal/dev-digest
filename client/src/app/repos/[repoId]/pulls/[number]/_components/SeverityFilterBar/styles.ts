import type { CSSProperties } from "react";

/** Co-located styles for SeverityFilterBar. */
export const s = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /**
   * A level this run has none of is dimmed but stays clickable: the selection
   * is shared across every run on the page, so a chip reading 0 here may read 3
   * in the accordion below.
   */
  chip: (empty: boolean): CSSProperties => ({
    display: "inline-flex",
    opacity: empty ? 0.5 : 1,
  }),
} as const;
