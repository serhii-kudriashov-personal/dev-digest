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

  it('get_blast_radius opens with the refusal', () => {
    const blast = tools.find((t) => t.name === 'get_blast_radius');
    expect(blast?.description.startsWith('Not implemented yet — do not retry.')).toBe(true);
  });

  it('instructions are three lines and never restate a parameter description', () => {
    const lines = INSTRUCTIONS.split('\n');
    expect(lines).toHaveLength(3);
    expect(INSTRUCTIONS).not.toContain('owner/name');
  });
});
