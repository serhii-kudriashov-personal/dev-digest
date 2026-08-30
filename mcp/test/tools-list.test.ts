/**
 * Protocol shape of the `tools/list` payload.
 *
 * Assertions are on `Object.keys`, never on a snapshot: a snapshot accepts a
 * new field the moment someone runs `-u`, which is exactly the leak these
 * checks exist to catch.
 */
import { describe, expect, it } from 'vitest';

import { INSTRUCTIONS, TOOLS } from '../src/tools.js';

const NAME_CHARSET = /^[A-Za-z0-9_.-]{1,128}$/;
const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

type ToolLike = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
};

const tools = TOOLS as readonly unknown[] as readonly ToolLike[];

describe('tools/list', () => {
  it('exposes exactly the five documented tools', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'list_agents',
      'run_agent_on_pr',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);
  });

  it('every name matches the MCP name charset', () => {
    for (const tool of tools) expect(NAME_CHARSET.test(tool.name), tool.name).toBe(true);
  });

  it('every inputSchema is a flat object of primitives with additionalProperties false', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);

      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [key, schema] of Object.entries(properties)) {
        expect(PRIMITIVE_TYPES.has(String(schema.type)), `${tool.name}.${key}`).toBe(true);
        // No nested objects, no arrays of objects, no enums.
        expect(Object.keys(schema).sort(), `${tool.name}.${key}`).toEqual(['description', 'type']);
      }
    }
  });

  it('carries no outputSchema on any tool', () => {
    for (const tool of tools) {
      expect(Object.keys(tool), tool.name).not.toContain('outputSchema');
    }
  });

  it('annotations match the contract exactly', () => {
    const expected: Record<string, Record<string, boolean>> = {
      list_agents: { readOnlyHint: true, openWorldHint: false },
      run_agent_on_pr: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      get_findings: { readOnlyHint: true, openWorldHint: false },
      get_conventions: { readOnlyHint: true, openWorldHint: false },
      get_blast_radius: { readOnlyHint: true, openWorldHint: false },
    };
    for (const tool of tools) expect(tool.annotations, tool.name).toEqual(expected[tool.name]);
  });

  it('run_agent_on_pr is the only tool that is not read-only', () => {
    const writers = tools.filter((t) => t.annotations.readOnlyHint === false).map((t) => t.name);
    expect(writers).toEqual(['run_agent_on_pr']);
  });

  it('descriptions are plain prose — no markdown, no JSON examples', () => {
    for (const tool of tools) {
      expect(tool.description, tool.name).not.toMatch(/^#|\n[-*]\s|\{"/);
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it('get_blast_radius describes the real tool, verbatim from its spec', () => {
    // L05 shipped this as a placeholder whose description opened with a refusal;
    // L06 implemented it. The string stays asserted VERBATIM — a paraphrase is a
    // defect, because the token budget was computed from these exact bytes.
    //
    // One word moved since L06: `specs/2026-08-28-gitlab-repositories.md`
    // §Contract promises (MCP row) makes the tool vocabulary provider-neutral,
    // so "pull request" became "change request". The budget still holds with
    // room to spare — `test/token-budget.test.ts` measures the serialized
    // payload rather than trusting this string's length — but the byte source of
    // record has NOT caught up: `specs/l06-blast-radius.md:301` still reads
    // "pull request", and `mcp/AGENTS.md` requires the spec to change first.
    // That drift is reported, not papered over here.
    const blast = tools.find((t) => t.name === 'get_blast_radius');
    expect(blast?.description).toBe(
      'Map what else a change request can affect: the symbols its changed files declare, ' +
        'who calls them, and which HTTP endpoints or scheduled jobs those callers serve. ' +
        'Served from a prebuilt index — no code is parsed and no model is called. When the ' +
        'index is missing or incomplete the result says so instead of guessing.',
    );
    expect(blast?.description).not.toContain('Not implemented');
  });

  it('never says "pull request" without naming the provider it belongs to', () => {
    // SPEC-06 AC-26/AC-27/AC-28 in this package's dialect: a repository on a
    // GitLab instance has merge requests, so an unqualified "pull request" in a
    // tool definition is a confident falsehood for half the repositories this
    // server can be pointed at. The provider-scoped strings are allowed and
    // deliberate — they name GitHub and GitLab in the same breath — so the rule
    // is "qualified or absent", not "absent".
    //
    // This runs on the ASSEMBLED strings, which is the whole point. The plan's
    // own `Done when` check is `rg -ni "pull request" mcp/src/tools.ts`, and
    // `rg` reads source lines: a description built by `+`-concatenation can
    // split the phrase across the join ("…review of a pull " + "request, …") and
    // satisfy the grep while shipping the exact bytes the grep exists to
    // forbid. Only the runtime value can see it.
    const strings = [
      ...tools.map((t) => `${t.name} description: ${t.description}`),
      ...tools.flatMap((t) => {
        const properties = (t.inputSchema.properties ?? {}) as Record<
          string,
          { description?: string }
        >;
        return Object.entries(properties).map(
          ([key, schema]) => `${t.name}.${key}: ${schema.description ?? ''}`,
        );
      }),
      `INSTRUCTIONS: ${INSTRUCTIONS}`,
    ];
    for (const entry of strings) {
      if (!/pull[- ]request/i.test(entry)) continue;
      expect(entry, `${entry} names a pull request without naming GitLab`).toMatch(/GitLab/);
    }
  });

  it('instructions are three lines and never restate a parameter description', () => {
    const lines = INSTRUCTIONS.split('\n');
    expect(lines).toHaveLength(3);
    expect(INSTRUCTIONS).not.toContain('owner/name');
  });
});
