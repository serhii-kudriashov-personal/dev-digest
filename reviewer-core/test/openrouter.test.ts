import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * Request-SHAPE tests for the OpenRouter provider.
 *
 * The point is what lands in the request body, not what the model says back —
 * `provider: { require_parameters: true }` is the difference between a request
 * that may be routed to an endpoint treating `response_format` as a hint and
 * one that cannot be. Its absence is invisible at runtime: the only symptom is
 * the repair loop exhausting its retries, which reads as a weak model.
 *
 * A stub stands in for the OpenAI SDK client and captures the body. Hermetic —
 * no key, no network (invariant #1).
 */

const Schema = z.object({ ok: z.boolean() });

interface Captured {
  provider?: { require_parameters?: boolean };
  [k: string]: unknown;
}

/** Build a provider whose SDK client is replaced by a body-capturing stub. */
function providerWithCapture(id: 'openai' | 'openrouter') {
  const bodies: Captured[] = [];
  const p = new OpenRouterProvider('test-key', { id });
  // The client is private; swapping it is the cheapest seam that still drives
  // the real completeStructured code path.
  (p as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (body: Captured) => {
          bodies.push(body);
          return {
            choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        },
      },
    },
  };
  return { provider: p, bodies };
}

const baseReq = {
  model: 'deepseek/deepseek-v4-flash-0731',
  schema: Schema,
  schemaName: 'Probe',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('OpenRouterProvider — provider routing', () => {
  it('sends provider.require_parameters when the caller asks for it', async () => {
    const { provider, bodies } = providerWithCapture('openrouter');
    await provider.completeStructured({
      ...baseReq,
      providerRouting: { requireParameters: true },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.provider).toEqual({ require_parameters: true });
  });

  it('sends NO provider key at all when not asked — existing runs are untouched', async () => {
    const { provider, bodies } = providerWithCapture('openrouter');
    await provider.completeStructured({ ...baseReq });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('provider');
  });

  it('omits the key for a non-OpenRouter provider even when asked', async () => {
    const { provider, bodies } = providerWithCapture('openai');
    await provider.completeStructured({
      ...baseReq,
      providerRouting: { requireParameters: true },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('provider');
  });

  it('omits the key when requireParameters is explicitly false', async () => {
    const { provider, bodies } = providerWithCapture('openrouter');
    await provider.completeStructured({
      ...baseReq,
      providerRouting: { requireParameters: false },
    });
    expect(bodies[0]).not.toHaveProperty('provider');
  });
});
