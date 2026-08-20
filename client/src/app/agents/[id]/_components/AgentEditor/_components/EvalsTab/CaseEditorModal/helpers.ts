/** File paths present in a stored unified-diff fragment (A11 — the Files tab
 *  is a READ-ONLY derivation, never a second stored input). */
export function filesInDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)) {
    if (match[1]) files.add(match[1]);
  }
  return [...files];
}

export interface CaseMeta {
  title?: string;
  body?: string;
}

/** `input_meta` is `z.unknown()` — read the two fields the case editor shows,
 *  without trusting its shape. */
export function metaOf(inputMeta: unknown): CaseMeta {
  if (!inputMeta || typeof inputMeta !== "object") return {};
  const m = inputMeta as Record<string, unknown>;
  return {
    title: typeof m.title === "string" ? m.title : undefined,
    body: typeof m.body === "string" ? m.body : undefined,
  };
}

/** `null` when the text is not valid JSON, so the caller can render the
 *  validity indicator and refuse to save (AC-13). */
export function tryParseJson(text: string): { valid: true; value: unknown } | { valid: false } {
  try {
    return { valid: true, value: JSON.parse(text) };
  } catch {
    return { valid: false };
  }
}
