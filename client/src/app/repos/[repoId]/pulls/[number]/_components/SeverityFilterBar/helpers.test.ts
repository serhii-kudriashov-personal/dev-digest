/**
 * `?severity=` round-trip — the contract that makes the filter shareable and
 * reload-safe (specs/findings-by-severity.md).
 */
import { describe, it, expect } from "vitest";
import { parseSeverityParam, serializeSeverityParam, toggleSeverity } from "./helpers";

describe("parseSeverityParam", () => {
  it("reads a multi-value param", () => {
    expect(parseSeverityParam("CRITICAL,WARNING")).toEqual(["CRITICAL", "WARNING"]);
  });

  it("treats absent / empty as no filter", () => {
    expect(parseSeverityParam(null)).toEqual([]);
    expect(parseSeverityParam("")).toEqual([]);
  });

  // A hand-edited or stale URL must widen the view, never break the page.
  it("ignores unknown tokens instead of failing", () => {
    expect(parseSeverityParam("CRITICAL,NOPE,,INFO")).toEqual(["CRITICAL"]);
    expect(parseSeverityParam("NOPE")).toEqual([]);
  });

  it("normalises casing, whitespace and duplicates to canonical order", () => {
    expect(parseSeverityParam(" warning , critical , warning ")).toEqual([
      "CRITICAL",
      "WARNING",
    ]);
  });
});

describe("serializeSeverityParam", () => {
  it("drops the key entirely for an empty selection", () => {
    expect(serializeSeverityParam([])).toBeNull();
  });

  it("emits canonical order regardless of click order", () => {
    expect(serializeSeverityParam(["SUGGESTION", "CRITICAL"])).toBe("CRITICAL,SUGGESTION");
  });

  it("round-trips through parse", () => {
    const selected = ["WARNING", "SUGGESTION"] as const;
    expect(parseSeverityParam(serializeSeverityParam([...selected]))).toEqual([...selected]);
  });
});

describe("toggleSeverity", () => {
  it("adds a level, keeping canonical order", () => {
    expect(toggleSeverity(["SUGGESTION"], "CRITICAL")).toEqual(["CRITICAL", "SUGGESTION"]);
  });

  it("clears a level that is already lit", () => {
    expect(toggleSeverity(["CRITICAL", "WARNING"], "CRITICAL")).toEqual(["WARNING"]);
  });

  it("returns to no-filter when the last lit level is cleared", () => {
    expect(toggleSeverity(["WARNING"], "WARNING")).toEqual([]);
  });
});
