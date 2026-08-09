import type { SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  DEFAULT_ROLE,
  GROUP_ORDER,
  PATH_PREFIX_PATTERN,
  SPLIT_DIR_DEPTH,
  SPLIT_MAX_PROPOSALS,
  SPLIT_MIN_FILES_PER_PROPOSAL,
  SPLIT_ROOT_GROUP_NAME,
  SPLIT_TOO_BIG_CORE_FILES,
  SPLIT_TOO_BIG_LINES,
  WIRING_PATTERNS,
} from './constants.js';

/**
 * Smart Diff slice — pure transforms. No I/O, no DB, no container, no LLM.
 *
 * Everything here is a total function of its arguments, which is what makes the
 * classification reproducible: the same PR always produces the same order.
 *
 * Ordering NEVER consults `findings.confidence`. That column is not calibrated
 * — it reads `1.0` on a hallucination (root `INSIGHTS.md` 2026-08-02) — so the
 * only signals used are the number of distinct flagged lines and the number of
 * changed lines.
 */

/** The subset of a `pr_files` row this feature needs. `patch` is deliberately absent. */
export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/** The subset of a `findings` row this feature needs. No severity, no prose. */
export interface SmartDiffFindingInput {
  file: string;
  start_line: number;
}

/**
 * Strip the `./`, `a/` and `b/` prefixes a unified diff adds, so a
 * model-authored `findings.file` still matches the `pr_files.path` it meant.
 */
export function normalizePath(path: string): string {
  return path.replace(PATH_PREFIX_PATTERN, '');
}

/**
 * The classifier. First match wins, boilerplate → wiring → core; see
 * `constants.ts` for why the order is the whole rule.
 */
export function classifyFile(path: string): SmartDiffRole {
  const normalized = normalizePath(path);
  if (BOILERPLATE_PATTERNS.some((p) => p.test(normalized))) return 'boilerplate';
  if (WIRING_PATTERNS.some((p) => p.test(normalized))) return 'wiring';
  return DEFAULT_ROLE;
}

/**
 * The distinct lines of `path` that carry a finding, ascending.
 *
 * Matching is on the normalized path and is EXACT. There is deliberately no
 * basename fallback: half the repo is called `index.ts`, and a fallback would
 * hang one directory's findings off another directory's file.
 */
export function findingLinesFor(path: string, findings: SmartDiffFindingInput[]): number[] {
  const target = normalizePath(path);
  const lines = new Set<number>();
  for (const finding of findings) {
    if (normalizePath(finding.file) === target) lines.add(finding.start_line);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Group and order a PR's files by risk.
 *
 * All three groups are emitted even when empty, so the UI renders three stable
 * sections instead of a layout that shifts with the PR. Within a group the sort
 * is fully deterministic: most flagged lines first, then most changed lines,
 * then path — no tie is ever left to insertion order.
 *
 * `pseudocode_summary` is always `null`. Filling it needs a model call, and
 * this feature makes none.
 */
export function buildSmartDiff(
  files: SmartDiffFileInput[],
  findings: SmartDiffFindingInput[],
): SmartDiff {
  const classified = files.map((file) => ({ file, role: classifyFile(file.path) }));

  const groups = GROUP_ORDER.map((role) => ({
    role,
    files: classified
      .filter((entry) => entry.role === role)
      .map(
        ({ file }): SmartDiffFile => ({
          path: file.path,
          pseudocode_summary: null,
          additions: file.additions,
          deletions: file.deletions,
          finding_lines: findingLinesFor(file.path, findings),
        }),
      )
      .sort(
        (a, b) =>
          b.finding_lines.length - a.finding_lines.length ||
          changedLines(b) - changedLines(a) ||
          a.path.localeCompare(b.path),
      ),
  }));

  return { groups, split_suggestion: suggestSplit(files) };
}

/**
 * A structural split proposal for an oversized PR.
 *
 * It groups the CORE files by their leading path segment and says nothing about
 * what they contain — a deterministic hint, not a plan. Non-core files are
 * counted in `total_lines` but never proposed: splitting a PR by moving its
 * lock file achieves nothing.
 */
export function suggestSplit(files: SmartDiffFileInput[]): SmartDiff['split_suggestion'] {
  const totalLines = files.reduce((sum, file) => sum + changedLines(file), 0);
  const coreFiles = files.filter((file) => classifyFile(file.path) === 'core');
  const tooBig = totalLines > SPLIT_TOO_BIG_LINES || coreFiles.length > SPLIT_TOO_BIG_CORE_FILES;

  if (!tooBig) return { too_big: false, total_lines: totalLines, proposed_splits: [] };

  const byDir = new Map<string, string[]>();
  for (const file of coreFiles) {
    const name = proposalName(file.path);
    const bucket = byDir.get(name);
    if (bucket) bucket.push(file.path);
    else byDir.set(name, [file.path]);
  }

  const proposedSplits = [...byDir.entries()]
    .filter(([, paths]) => paths.length >= SPLIT_MIN_FILES_PER_PROPOSAL)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, SPLIT_MAX_PROPOSALS)
    .map(([name, paths]) => ({ name, files: [...paths].sort((a, b) => a.localeCompare(b)) }));

  return { too_big: true, total_lines: totalLines, proposed_splits: proposedSplits };
}

function changedLines(file: { additions: number; deletions: number }): number {
  return file.additions + file.deletions;
}

/** The leading path segment(s) a split proposal is named after. */
function proposalName(path: string): string {
  const segments = normalizePath(path).split('/');
  if (segments.length <= SPLIT_DIR_DEPTH) return SPLIT_ROOT_GROUP_NAME;
  return segments.slice(0, SPLIT_DIR_DEPTH).join('/');
}
