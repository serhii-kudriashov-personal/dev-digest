/**
 * formatCost — the cost badge's display contract (specs/l01-run-cost-badge.md).
 *
 * The load-bearing rule: an unknown cost renders "—", never "$0.00". A run that
 * failed before billing anything must not look free, and a sub-cent run must
 * not round away to zero.
 */
import { describe, it, expect } from "vitest";
import { formatCost, formatTokenCount } from "./format";

describe("formatCost", () => {
  it('renders "—" when the cost is unknown', () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(NaN)).toBe("—");
  });

  it("keeps ~3 significant digits as the magnitude changes", () => {
    expect(formatCost(0.00128)).toBe("$0.0013"); // sub-cent → 4dp
    expect(formatCost(0.0141)).toBe("$0.014"); // cents → 3dp
    expect(formatCost(0.06)).toBe("$0.060");
    expect(formatCost(1.2431)).toBe("$1.24"); // dollars → 2dp
  });

  it("never rounds a real sub-cent cost down to $0.00", () => {
    expect(formatCost(0.00006)).toBe("$0.0001");
    expect(formatCost(0.0000004)).not.toBe("$0.00");
  });

  it("distinguishes a genuine zero from an unknown cost", () => {
    // 0 is a fact ("this run really cost nothing"); null is an absence.
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(null)).toBe("—");
  });
});

describe("formatTokenCount", () => {
  it("groups thousands and appends the unit", () => {
    expect(formatTokenCount(9119)).toBe("9,119 tok");
  });

  it("returns null when there is nothing to show", () => {
    expect(formatTokenCount(null)).toBeNull();
    expect(formatTokenCount(undefined)).toBeNull();
    expect(formatTokenCount(0)).toBeNull();
  });
});
