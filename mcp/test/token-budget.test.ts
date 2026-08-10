/**
 * The token budget gate.
 *
 * It measures the EXACT `tools/list` result object the server serves —
 * `{ tools: TOOLS }`, the same array imported, never a re-declaration — because
 * a budget computed from a copy is a budget for a payload nobody sends.
 *
 * KNOWN INACCURACY, on purpose. `cl100k_base` is OpenAI's tokenizer; Anthropic's
 * differs, and the `claude-api` skill says to use `messages.count_tokens`
 * instead. That is right for a production estimate and wrong for this test:
 * `count_tokens` needs a network call and an API key, which would make a unit
 * test non-hermetic and key-gated — exactly what `TESTING.md` §Philosophy rules
 * out. The mitigation is headroom: at roughly half the ceiling, a ±20%
 * tokenizer error cannot flip the verdict. If a real Anthropic number is ever
 * wanted, produce it once by hand with `count_tokens` and record it in
 * `mcp/AGENTS.md` — do not put a network call in this suite.
 */
import { getEncoding } from 'js-tiktoken';
import { describe, expect, it } from 'vitest';

import { INSTRUCTIONS_TOKEN_BUDGET, TOOL_DEFINITION_TOKEN_BUDGET } from '../src/constants.js';
import { INSTRUCTIONS, TOOLS } from '../src/tools.js';

const encoding = getEncoding('cl100k_base');
const count = (text: string) => encoding.encode(text).length;

describe('token budget', () => {
  it(`serialized tools/list fits in ${TOOL_DEFINITION_TOKEN_BUDGET} cl100k_base tokens`, () => {
    const total = count(JSON.stringify({ tools: TOOLS }));

    // The breakdown is printed so a regression NAMES the tool that grew.
    const breakdown = TOOLS.map((tool) => `${tool.name}: ${count(JSON.stringify(tool))}`);
    // eslint-disable-next-line no-console -- test output, not the stdio transport
    console.info(
      `tools/list = ${total} / ${TOOL_DEFINITION_TOKEN_BUDGET} tokens\n  ${breakdown.join('\n  ')}`,
    );

    expect(
      total,
      `tools/list is ${total} tokens, over the ${TOOL_DEFINITION_TOKEN_BUDGET} budget. Per tool: ${breakdown.join(', ')}`,
    ).toBeLessThanOrEqual(TOOL_DEFINITION_TOKEN_BUDGET);
  });

  it('names the tool that grew when a single definition is oversized', () => {
    // No one tool may take more than half the whole budget on its own — that is
    // what makes the failure message above point at a culprit rather than at
    // "the payload".
    for (const tool of TOOLS) {
      const size = count(JSON.stringify(tool));
      expect(size, `${tool.name} alone is ${size} tokens`).toBeLessThanOrEqual(
        TOOL_DEFINITION_TOKEN_BUDGET / 2,
      );
    }
  });

  it(`instructions fit in ${INSTRUCTIONS_TOKEN_BUDGET} tokens, counted separately`, () => {
    // `instructions` ships in the `initialize` result, NOT in `tools/list`, so
    // folding it into the same number would misreport both.
    const total = count(INSTRUCTIONS);
    // eslint-disable-next-line no-console -- test output, not the stdio transport
    console.info(`instructions = ${total} / ${INSTRUCTIONS_TOKEN_BUDGET} tokens`);
    expect(total).toBeLessThanOrEqual(INSTRUCTIONS_TOKEN_BUDGET);
  });
});
