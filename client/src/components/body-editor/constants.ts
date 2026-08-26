/**
 * Constants owned by the body editor.
 *
 * They lived at `src/app/skills/constants.ts` while the editor was route-local.
 * The editor is now shared by /skills and the conventions extractor's create-skill
 * modal, so a cross-route component must not reach back into one route for its own
 * literals (client/INSIGHTS.md — cross-route components live in src/components/).
 */

/**
 * How many characters approximate one token.
 *
 * Same divisor the server ships as `approxTokens`, so the editor's estimate and
 * the server's fallback agree. The trace's `token_counts` remains the real
 * tiktoken figure — this one is rendered with a `~` because it is a guess.
 */
export const CHARS_PER_TOKEN = 4;

/** Debounce for the token estimate, in ms. */
export const TOKEN_ESTIMATE_DEBOUNCE_MS = 250;
