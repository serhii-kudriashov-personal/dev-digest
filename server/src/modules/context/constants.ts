/**
 * Project Context (SPEC-01) — literals.
 *
 * Every cap in this file is a product decision from the spec, not a tuning
 * knob: the numbers are what the UI promises the user and what the tests assert.
 */

/**
 * Discovery roots used when `repos.context_roots` is NULL (AC-1).
 *
 * Depth-agnostic on purpose — `packages/api/docs/auth.md` is as much project
 * documentation as `docs/auth.md`. That is exactly why `EXCLUDED_DIRS` is
 * load-bearing in the walker rather than tidiness: `**​/docs/**` also matches
 * `node_modules/<pkg>/docs/readme.md` (`server/INSIGHTS.md` 2026-08-16).
 */
export const DEFAULT_CONTEXT_ROOTS = ['**/{specs,docs,insights}/**/*.md'] as const;

/**
 * `.md` only — deliberately NOT `/\.mdx?$/i` like `intent/helpers.ts:100`.
 * The divergence is spec Open question 1, a recorded decision; whoever
 * reconciles the two later picks it up there.
 */
export const CONTEXT_DOC_EXT = '.md';

/** Documents the listing will return in one response (NFR-4). */
export const MAX_LISTED_DOCUMENTS = 500;

/** Documents one agent can effectively inject, direct + skill-inherited (NFR-4). */
export const MAX_DOCS_PER_AGENT = 8;

/** Characters of one document that reach the prompt; the rest is cut (NFR-5). */
export const MAX_DOCUMENT_CHARS = 8_000;

/** Wall-clock budget for the whole run-time read pass (NFR-2). */
export const RUNTIME_READ_BUDGET_MS = 5_000;

/**
 * Ceiling on brace expansion of one root pattern. The roots are user input, so
 * `{a,b}{c,d}{e,f}…` is an expansion bomb unless something stops it; a pattern
 * that expands past this is treated as matching nothing rather than hanging.
 */
export const MAX_ROOT_EXPANSIONS = 64;
