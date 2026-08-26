import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface PriceBookEntry {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export function loadPriceBook(): PriceBookEntry[] {
  const raw = readFileSync(path.join(__dirname, 'price-book.json'), 'utf8');
  return JSON.parse(raw) as PriceBookEntry[];
}

export function estimateCostUsd(
  entries: PriceBookEntry[],
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  const entry = entries.find((e) => e.model === model);
  if (!entry) return null;
  return (inputTokens / 1_000_000) * entry.inputPerMTok + (outputTokens / 1_000_000) * entry.outputPerMTok;
}
