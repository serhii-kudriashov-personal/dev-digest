import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff slice — literals only. Every pattern and every threshold the
 * feature has lives in this file; `helpers.ts`, `service.ts` and `routes.ts`
 * carry no path literal and no number.
 *
 * FIRST MATCH WINS, in this order:
 *
 *   1. BOILERPLATE_PATTERNS
 *   2. WIRING_PATTERNS
 *   3. DEFAULT_ROLE (= 'core')
 *
 * The order is the whole classifier. It is why a lock file can never be
 * anything but `boilerplate`: `pnpm-lock.yaml` is matched by rule 1 before any
 * later rule is consulted, and `dist/index.js` is boilerplate rather than a
 * wiring barrel for the same reason.
 *
 * Two placements that are judgement, not deduction, and are therefore stated
 * rather than left to be reverse-engineered from the regexes:
 *
 * - **Tests and Markdown are `wiring`.** They are a supporting change, not the
 *   substance of one — worth reading, not worth reading first.
 * - **`package.json` is `boilerplate`.** A dependency bump is mechanical, and
 *   the design this feature implements groups manifests with their lock files.
 *
 * Classification is deterministic code on purpose. Nothing here is a prompt
 * instruction, and no model is asked to sort a diff (root `INSIGHTS.md`
 * 2026-08-02: stacking convention blocks into a `system_prompt` made the
 * review measurably worse).
 *
 * All patterns are matched against a NORMALIZED path (see `normalizePath` in
 * `helpers.ts`), so they anchor on `(^|/)` rather than on `^`.
 */

/**
 * Generated, vendored or mechanical — skim, never review line by line.
 * Consulted first, so anything here is boilerplate whatever else it looks like.
 */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  // Lock files — the canonical "never read this" file.
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum|Gemfile\.lock)$/,
  // Dependency manifests: mechanical, and grouped with their lock files.
  /(^|\/)(package\.json|pnpm-workspace\.yaml)$/,
  // Build output and installed dependencies.
  /(^|\/)(dist|build|out|\.next|coverage|node_modules)\//,
  // Vendored trees — copied in, not authored here.
  /(^|\/)vendor\//,
  // Test snapshots: regenerated, never hand-written.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  // Minified or code-generated output.
  /\.min\.(js|css)$/,
  /\.generated\.[^/]+$/,
  /\.pb\.go$/,
  // Binary and asset files — there is no diff to read.
  /\.(png|jpe?g|gif|svg|ico|woff2?|ttf|pdf)$/,
];

/**
 * Hooks the core into the app: barrels, config, CI, migrations, tests, docs.
 * Real changes, but they describe how the substance is wired up rather than
 * being the substance.
 */
export const WIRING_PATTERNS: readonly RegExp[] = [
  // Barrels — re-exports, no logic.
  /(^|\/)index\.(ts|tsx|js)$/,
  // Config of every shape.
  /\.config\.(ts|js|mjs|cjs)$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /(^|\/)\.?env(\.[^/]*)?$/,
  // CI and containers.
  /(^|\/)\.github\/workflows\//,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  // SQL migrations.
  /(^|\/)migrations?\//,
  /\.sql$/,
  // Ambient type declarations.
  /\.d\.ts$/,
  // Tests — a supporting change, not the substance.
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)(test|tests|__tests__)\//,
  // Documentation — same reasoning as tests.
  /\.mdx?$/,
];

/**
 * The prefixes a unified diff puts in front of a path. `findings.file` is
 * model-authored and sometimes carries one; `pr_files.path` never does, so both
 * sides are normalized before they are compared or matched.
 */
export const PATH_PREFIX_PATTERN = /^(\.\/|a\/|b\/)+/;

/** What a path is when no pattern claims it: the substance of the change. */
export const DEFAULT_ROLE: SmartDiffRole = 'core';

/**
 * The order groups are emitted in, and the order they are rendered in. A group
 * with no files is still emitted, so the UI has three stable sections.
 */
export const GROUP_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

// ---- Split suggestion thresholds -----------------------------------------
// A PR past either threshold is flagged as "too big"; the proposal is a purely
// structural grouping of its CORE files, never a judgement about their content.

/** Total changed lines (additions + deletions, all files) past which a PR is too big. */
export const SPLIT_TOO_BIG_LINES = 400;
/** Number of `core` files past which a PR is too big regardless of line count. */
export const SPLIT_TOO_BIG_CORE_FILES = 10;
/** A proposal naming fewer files than this is noise, not a split. */
export const SPLIT_MIN_FILES_PER_PROPOSAL = 2;
/** At most this many proposals are returned. */
export const SPLIT_MAX_PROPOSALS = 4;
/** How many leading path segments name a proposal (1 = the top-level directory). */
export const SPLIT_DIR_DEPTH = 1;
/** What a repo-root file's proposal is called, since it has no directory. */
export const SPLIT_ROOT_GROUP_NAME = '.';
