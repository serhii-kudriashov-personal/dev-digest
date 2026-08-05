import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { countReachingPrompt, filterByName, orderedSkillIds, reorder } from "./helpers";

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

const skill = (id: string, name: string, enabled = true): Skill => ({
  id,
  name,
  description: "",
  type: "custom",
  source: "manual",
  body: "x",
  enabled,
  version: 1,
  evidence_files: null,
});

describe("orderedSkillIds", () => {
  it("sorts by order, not by the order the API happened to return", () => {
    expect(orderedSkillIds([link("c", 2), link("a", 0), link("b", 1)])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for undefined links (first render, before the fetch)", () => {
    expect(orderedSkillIds(undefined)).toEqual([]);
  });
});

describe("reorder", () => {
  it("moves an item down", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item up", () => {
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the SAME array reference when nothing moves", () => {
    // The caller skips the mutation on reference equality, so a drag that ends
    // where it started must not fire a pointless write.
    const ids = ["a", "b", "c"];
    expect(reorder(ids, 1, 1)).toBe(ids);
  });

  it("ignores out-of-range indices instead of corrupting the list", () => {
    const ids = ["a", "b"];
    expect(reorder(ids, -1, 0)).toBe(ids);
    expect(reorder(ids, 0, 5)).toBe(ids);
  });
});

describe("filterByName", () => {
  const library = [skill("1", "test-coverage-nudge"), skill("2", "lethal-trifecta")];

  it("matches case-insensitively", () => {
    expect(filterByName(library, "TRIFECTA").map((s) => s.id)).toEqual(["2"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterByName(library, "   ")).toHaveLength(2);
  });
});

describe("countReachingPrompt", () => {
  const byId = new Map([
    ["on", skill("on", "on")],
    ["off", skill("off", "off", false)],
  ]);

  it("counts only attached skills that are globally enabled", () => {
    // A disabled skill stays attached and keeps its position, but the run
    // executor filters it out, so it must not be counted as reaching the prompt.
    expect(countReachingPrompt(["on", "off"], byId)).toBe(1);
  });

  it("is zero when nothing is attached", () => {
    expect(countReachingPrompt([], byId)).toBe(0);
  });
});
