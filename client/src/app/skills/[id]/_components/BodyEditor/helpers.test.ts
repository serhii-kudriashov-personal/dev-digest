import { describe, it, expect } from "vitest";
import { bodyFilename, estimateTokens, lineCount } from "./helpers";

describe("lineCount", () => {
  it("counts an empty body as one line, so the gutter still shows line 1", () => {
    expect(lineCount("")).toBe(1);
  });

  it("counts lines, not newlines", () => {
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb")).toBe(2);
  });

  it("counts a trailing newline as opening a new line", () => {
    // The caret sits on line 3 after "a\nb\n", and the gutter has to agree.
    expect(lineCount("a\nb\n")).toBe(3);
  });
});

describe("estimateTokens", () => {
  it("uses the same chars-per-token divisor as the server's approxTokens", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up, so any non-empty body costs at least one token", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("bodyFilename", () => {
  it("appends .md to the skill slug", () => {
    expect(bodyFilename("pr-quality-rubric")).toBe("pr-quality-rubric.md");
  });

  it("does not double the extension", () => {
    expect(bodyFilename("already.md")).toBe("already.md");
  });

  it("falls back to a placeholder while the name field is empty", () => {
    expect(bodyFilename("")).toBe("skill.md");
    expect(bodyFilename("   ")).toBe("skill.md");
  });
});
