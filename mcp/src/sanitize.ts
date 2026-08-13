/**
 * Untrusted-content handling for text leaving this process.
 *
 * Finding titles and suggestions, PR text and convention rules are DATA: LLM
 * output plus prose written by external pull-request authors, being handed into
 * a second model's context. Root `INSIGHTS.md` (2026-08-05) says a *skill body*
 * must not be wrapped because a skill IS an instruction — the converse holds
 * here, so this content is fenced.
 *
 * Two honest limits, both restated in `AGENTS.md`:
 *
 * 1. A delimiter is a MITIGATION, not a control.
 * 2. The receiving model is a third-party client whose system prompt we do not
 *    write, so unlike `reviewer-core` there is no `INJECTION_GUARD` on the other
 *    side telling it what the fence means. The `initialize` instructions say it
 *    once, and not every client surfaces those.
 *
 * The belt under the braces: strip ASCII control characters, neutralise any
 * fence-lookalike the text carries, and hard-cap the length before fencing.
 *
 * This is a LOCAL equivalent of `reviewer-core`'s `wrapUntrusted`, written out
 * rather than imported. Root `INSIGHTS.md` (2026-08-09): ring 1's barrel must
 * not grow a public export for a consumer no engine path calls.
 */

/**
 * ASCII control characters, minus the two that are legitimate in prose (\t, \n).
 * Built from a string so no literal control byte is ever typed into this file.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');
const FENCE_LOOKALIKE = /<\/?\s*untrusted[^>]*>/gi;

/** Strip ASCII control characters, keeping tabs and newlines. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, '');
}

/** Hard-cap a field, marking the cut so the model knows it is reading a prefix. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Clean and fence one untrusted field.
 *
 * `label` names what the text is (`title`, `suggestion`, `rule`) so a reader —
 * human or model — can tell which part of the payload is third-party prose.
 */
export function fenceUntrusted(label: string, text: string, max: number): string {
  const cleaned = truncate(stripControlChars(text).replace(FENCE_LOOKALIKE, '[]'), max);
  return `<untrusted kind="${label}">${cleaned}</untrusted>`;
}

/** Clean without fencing — for values the engine produced, not a third party. */
export function clean(text: string, max: number): string {
  return truncate(stripControlChars(text), max);
}
