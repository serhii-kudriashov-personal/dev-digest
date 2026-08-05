import { describe, it, expect } from "vitest";
import { diffLines, diffStat } from "./helpers";

describe("diffLines", () => {
  it("marks every line same for identical text", () => {
    const out = diffLines("a\nb", "a\nb");
    expect(out.map((l) => l.op)).toEqual(["same", "same"]);
  });

  it("detects an added line and keeps the surrounding context", () => {
    const out = diffLines("a\nc", "a\nb\nc");
    expect(out).toEqual([
      { op: "same", text: "a" },
      { op: "add", text: "b" },
      { op: "same", text: "c" },
    ]);
  });

  it("detects a removed line", () => {
    const out = diffLines("a\nb\nc", "a\nc");
    expect(out).toEqual([
      { op: "same", text: "a" },
      { op: "del", text: "b" },
      { op: "same", text: "c" },
    ]);
  });

  it("represents a changed line as a delete plus an add", () => {
    const ops = diffLines("a\nold\nc", "a\nnew\nc").map((l) => `${l.op}:${l.text}`);
    expect(ops).toContain("del:old");
    expect(ops).toContain("add:new");
    expect(ops.filter((o) => o.startsWith("same"))).toHaveLength(2);
  });

  it("handles an empty side in both directions", () => {
    expect(diffLines("", "a").filter((l) => l.op === "add")).toHaveLength(1);
    expect(diffLines("a", "").filter((l) => l.op === "del")).toHaveLength(1);
  });

  it("finds the longest common subsequence rather than diffing pairwise", () => {
    // A naive line-by-line compare would call all four lines changed; LCS keeps
    // the three shared ones and reports a single insertion.
    const out = diffLines("one\ntwo\nthree", "one\ninserted\ntwo\nthree");
    expect(out.filter((l) => l.op === "same").map((l) => l.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(out.filter((l) => l.op === "add")).toEqual([{ op: "add", text: "inserted" }]);
    expect(out.filter((l) => l.op === "del")).toHaveLength(0);
  });

  it("preserves blank lines as content, not as absence", () => {
    const out = diffLines("a\n\nb", "a\nb");
    expect(out.filter((l) => l.op === "del")).toEqual([{ op: "del", text: "" }]);
  });
});

describe("diffStat", () => {
  it("counts additions and removals, ignoring unchanged lines", () => {
    expect(diffStat(diffLines("a\nb\nc", "a\nx\ny\nc"))).toEqual({ added: 2, removed: 1 });
  });

  it("is all zeroes for identical text", () => {
    expect(diffStat(diffLines("same", "same"))).toEqual({ added: 0, removed: 0 });
  });
});
