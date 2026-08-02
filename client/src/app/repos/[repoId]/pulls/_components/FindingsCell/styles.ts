import type { CSSProperties } from "react";

/**
 * Co-located styles for the PR list's findings cell. The card itself is styled
 * by `@/components/findings-hover-card`; this is only the grid cell it anchors
 * to, used both for the hoverable case and the never-reviewed `—`.
 */
export const s = {
  cell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
    // The cell owns the hover, so give it something to hover even when the
    // badges are narrow.
    alignSelf: "stretch",
  } satisfies CSSProperties,
} as const;
