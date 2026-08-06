import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { acceptedIds, scanAge } from "./helpers";

const NOW = new Date("2026-08-05T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("scanAge", () => {
  it("reads as just now under a minute", () => {
    expect(scanAge(ago(30_000), NOW)).toEqual({ unit: "justNow", count: 0 });
  });

  it("counts minutes, hours and days", () => {
    expect(scanAge(ago(5 * 60_000), NOW)).toEqual({ unit: "minutes", count: 5 });
    expect(scanAge(ago(60 * 60_000), NOW)).toEqual({ unit: "hours", count: 1 });
    expect(scanAge(ago(3 * 24 * 60 * 60_000), NOW)).toEqual({ unit: "days", count: 3 });
  });

  it("never reports a negative age when the API clock is ahead of the browser", () => {
    expect(scanAge(new Date(NOW + 60_000).toISOString(), NOW)).toEqual({
      unit: "justNow",
      count: 0,
    });
  });

  it("degrades to just now for an unparseable timestamp rather than rendering NaN", () => {
    expect(scanAge("not-a-date", NOW)).toEqual({ unit: "justNow", count: 0 });
  });
});

describe("acceptedIds", () => {
  const c = (id: string, status: ConventionCandidate["status"], confidence: number) =>
    ({ id, status, confidence }) as ConventionCandidate;

  it("returns only the accepted ids", () => {
    const ids = acceptedIds([
      c("a", "accepted", 0.1),
      c("b", "pending", 0.9),
      c("c", "rejected", 0.9),
      c("d", "accepted", 0.5),
    ]);
    expect(ids).toEqual(["a", "d"]);
  });

  it("preserves render order rather than sorting by confidence", () => {
    // confidence is not calibrated, so it must not rank anything — including the
    // order rules land in the generated skill.
    expect(acceptedIds([c("low", "accepted", 0.1), c("high", "accepted", 0.99)])).toEqual([
      "low",
      "high",
    ]);
  });
});
