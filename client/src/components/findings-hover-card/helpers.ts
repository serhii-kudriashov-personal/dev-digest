import type { FindingRecord } from "@devdigest/shared";
import { POPOVER_MAX_HEIGHT, POPOVER_OFFSET, POPOVER_WIDTH, SEVERITY_ORDER } from "./constants";

/** Sort findings worst-first. An unrecognised severity sorts last, never throws. */
export function sortBySeverity(findings: FindingRecord[]): FindingRecord[] {
  const rank = (f: FindingRecord) => {
    const i = SEVERITY_ORDER.indexOf(f.severity as (typeof SEVERITY_ORDER)[number]);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return [...findings].sort((a, b) => rank(a) - rank(b));
}

export interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * Place the card under the anchor, flipping above it when the viewport has no
 * room below (the bottom rows of a long list) and clamping so it never runs off
 * the right edge.
 */
export function popoverPosition(
  anchor: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
): PopoverPosition {
  const below = viewport.height - anchor.bottom;
  const flipUp = below < POPOVER_MAX_HEIGHT + POPOVER_OFFSET && anchor.top > below;
  return {
    top: flipUp
      ? Math.max(POPOVER_OFFSET, anchor.top - POPOVER_MAX_HEIGHT - POPOVER_OFFSET)
      : anchor.bottom + POPOVER_OFFSET,
    left: Math.max(
      POPOVER_OFFSET,
      Math.min(anchor.left, viewport.width - POPOVER_WIDTH - POPOVER_OFFSET),
    ),
  };
}
