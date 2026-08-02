/**
 * Hover-card placement and ordering — the two pure parts of the card, shared by
 * the PR list cell and the Review Runs header (specs/findings-by-severity.md).
 *
 * Placement is worth pinning because the interesting case — the LAST row of a
 * long list, where "always below" runs off screen — is exactly the one nobody
 * hits in dev.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { popoverPosition, sortBySeverity } from "./helpers";
import { POPOVER_MAX_HEIGHT, POPOVER_OFFSET, POPOVER_WIDTH } from "./constants";

const VIEWPORT = { width: 1440, height: 900 };

describe("popoverPosition", () => {
  it("sits below the anchor when there is room", () => {
    const p = popoverPosition({ top: 100, bottom: 120, left: 800 }, VIEWPORT);
    expect(p.top).toBe(120 + POPOVER_OFFSET);
    expect(p.left).toBe(800);
  });

  it("flips above the anchor for a row near the bottom", () => {
    const p = popoverPosition({ top: 840, bottom: 860, left: 800 }, VIEWPORT);
    expect(p.top).toBe(840 - POPOVER_MAX_HEIGHT - POPOVER_OFFSET);
  });

  // A short viewport has room neither way; staying on screen beats flipping.
  it("never places the card off the top edge", () => {
    const p = popoverPosition({ top: 40, bottom: 60, left: 800 }, { width: 1440, height: 300 });
    expect(p.top).toBeGreaterThanOrEqual(POPOVER_OFFSET);
  });

  it("clamps so the card never runs off the right edge", () => {
    const p = popoverPosition({ top: 100, bottom: 120, left: 1300 }, VIEWPORT);
    expect(p.left).toBe(VIEWPORT.width - POPOVER_WIDTH - POPOVER_OFFSET);
    expect(p.left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });
});

const f = (id: string, severity: string): FindingRecord =>
  ({ id, severity, title: id }) as unknown as FindingRecord;

describe("sortBySeverity", () => {
  it("orders worst first regardless of input order", () => {
    const out = sortBySeverity([f("s", "SUGGESTION"), f("c", "CRITICAL"), f("w", "WARNING")]);
    expect(out.map((x) => x.id)).toEqual(["c", "w", "s"]);
  });

  // `findings.severity` is a plain text column with no check constraint, so an
  // unknown level must sort last rather than throw or jump to the front.
  it("sorts an unrecognised severity last", () => {
    const out = sortBySeverity([f("x", "INFO"), f("c", "CRITICAL")]);
    expect(out.map((x) => x.id)).toEqual(["c", "x"]);
  });

  it("does not mutate its input", () => {
    const input = [f("s", "SUGGESTION"), f("c", "CRITICAL")];
    sortBySeverity(input);
    expect(input.map((x) => x.id)).toEqual(["s", "c"]);
  });
});
