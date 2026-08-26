import { CHARS_PER_TOKEN } from "./constants";

/**
 * Approximate token count for the editor's header.
 *
 * Same chars-per-token divisor the server ships as `approxTokens`, so the two
 * agree. This is an ESTIMATE and the UI labels it with a `~`; the run trace's
 * `token_counts.skills` carries the real tiktoken figure, measured server-side at
 * assembly time.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Line count, and therefore gutter length. An empty body still shows line 1. */
export function lineCount(text: string): number {
  return text.split("\n").length;
}

/** `pr-quality-rubric` → `pr-quality-rubric.md`; a name already ending in .md is left alone. */
export function bodyFilename(skillName: string): string {
  const base = skillName.trim() || "skill";
  return /\.mda?$/i.test(base) ? base : `${base}.md`;
}
