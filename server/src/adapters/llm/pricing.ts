/**
 * cost discipline — per-provider/model pricing table (USD per 1M tokens).
 * Unknown models return null cost (explicitly flagged), per spec.
 */
interface Price {
  in: number;
  out: number;
}

const PRICING: Record<string, Price> = {
  // OpenAI (approximate public list prices, USD / 1M tokens)
  'gpt-5.5': { in: 5.0, out: 30.0 },
  'gpt-5.4': { in: 2.5, out: 15.0 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  'gpt-5.1': { in: 1.25, out: 10.0 },
  'gpt-5': { in: 1.25, out: 10.0 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  // Anthropic
  'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4.0 },
  'claude-3-opus-latest': { in: 15.0, out: 75.0 },
  // OpenRouter (CI runner, cheap models). Slugs + prices are APPROXIMATE and
  // must be confirmed against openrouter.ai/models before relying on cost.
  // Unknown slugs fall through to null cost (explicitly flagged), which is safe.
  'z-ai/glm-4.7-flash': { in: 0, out: 0 }, // free baseline for evals
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
  // A DIFFERENT, NEWER, CHEAPER snapshot than the bare slug above — not a
  // freshness suffix on the same model. The bare slug resolves to
  // `deepseek-v4-flash-20260423` at $0.14/$0.28; this dated one is what
  // `~deepseek/deepseek-v4-flash-latest` currently aliases to. Do NOT reuse the
  // row above for this slug, or the cost is attributed from the other
  // snapshot's prices — silently, with no error. Confirmed against
  // openrouter.ai/api/v1/models on 2026-08-08; `review_intent` pins it.
  'deepseek/deepseek-v4-flash-0731': { in: 0.09, out: 0.18 },
  'z-ai/glm-4.7-flashx': { in: 0.15, out: 0.4 },
  'minimax/minimax-m2.5': { in: 0.3, out: 1.2 },
  'z-ai/glm-5.1': { in: 0.6, out: 2.2 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
