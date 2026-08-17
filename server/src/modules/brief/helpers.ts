import type { BriefAnswer, BriefFocus, BriefRisk } from '@devdigest/shared';
import { PATH_PREFIX_PATTERN } from '../smart-diff/constants.js';
import {
  BRIEF_MAX_FOCUS,
  BRIEF_MAX_FOCUS_REASON,
  BRIEF_MAX_RISK_EXPLANATION,
  BRIEF_MAX_RISKS,
  SECRET_PATTERNS,
} from './constants.js';

/**
 * PR Risk Brief slice — pure transforms. No I/O, no persistence, no DI, no `this`.
 *
 * `validateFocus` and `validateRisks` are the enforcement points for AC-17…20:
 * nothing the model claims about a file, a line or an endpoint is trusted
 * until it is checked against the PR's own data.
 */

export interface ChangedRange {
  start: number;
  end: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * The new-side line RANGES a patch touches — never the hunk body. Duplicated
 * from `intent/helpers.ts#hunkHeaders`'s reasoning rather than imported: that
 * file is `SLICE_PRIVATE` and `no-cross-slice-import` would fail
 * (`server/INSIGHTS.md` 2026-08-17). Promote to `modules/_shared/pr-text.ts`
 * if a third slice ever needs the same parse.
 *
 * A `+0` hunk (pure deletion on the new side) contributes no addable line and
 * is skipped, not turned into an inverted range.
 */
export function changedRanges(patch: string | null): ChangedRange[] {
  if (!patch) return [];
  const ranges: ChangedRange[] = [];
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const len = m[2] !== undefined ? Number(m[2]) : 1;
    if (len <= 0) continue;
    ranges.push({ start, end: start + len - 1 });
  }
  return ranges;
}

/**
 * Strip the `./`, `a/`, `b/` unified-diff prefixes, so a model-authored path
 * still matches the `pr_files.path` it meant. Re-derived from the IMPORTABLE
 * `smart-diff/constants.ts#PATH_PREFIX_PATTERN` rather than importing
 * `smart-diff/helpers.ts#normalizePath` (`SLICE_PRIVATE`), which keeps the
 * normalization RULE single-sourced even though the call site is duplicated
 * (`server/INSIGHTS.md` 2026-08-17). Inherits the documented sharp edge: a
 * repo with a real top-level `a/` or `b/` directory strips it too
 * (`server/INSIGHTS.md` 2026-08-09) — AC-17 wants exact match, not a
 * best-effort one, so this is not worked around.
 */
export function normalizeBriefPath(path: string): string {
  return path.replace(PATH_PREFIX_PATTERN, '');
}

/**
 * Drop a focus entry whose normalized path is not one of the PR's changed
 * files (AC-17, no basename fallback — half the repo is `index.ts`). Keep an
 * entry whose line falls outside every changed range, but RETARGET it to that
 * file's first changed line rather than dropping it (AC-18) — the file is
 * genuinely worth a look even if the model mis-cited the exact line.
 */
export function validateFocus(
  entries: readonly BriefFocus[],
  rangesByPath: ReadonlyMap<string, ChangedRange[]>,
): { kept: BriefFocus[]; dropped: number } {
  const kept: BriefFocus[] = [];
  let dropped = 0;
  for (const entry of entries) {
    const path = normalizeBriefPath(entry.path);
    const ranges = rangesByPath.get(path);
    if (!ranges || ranges.length === 0) {
      dropped++;
      continue;
    }
    const inRange = ranges.some((r) => entry.line >= r.start && entry.line <= r.end);
    kept.push(inRange ? entry : { ...entry, line: ranges[0]!.start });
  }
  return { kept, dropped };
}

/**
 * Drop a risk that names a file outside the diff, or an endpoint/cron name
 * that never appeared in the blast-radius input (AC-19). A risk with no
 * `file_refs`/`endpoint_refs` at all always survives this check — it is
 * simply not making a checkable claim.
 */
export function validateRisks(
  risks: readonly BriefRisk[],
  changedPaths: readonly string[],
  knownEndpoints: readonly string[],
): { kept: BriefRisk[]; dropped: number } {
  const changedSet = new Set(changedPaths.map(normalizeBriefPath));
  const endpointSet = new Set(knownEndpoints);
  const kept: BriefRisk[] = [];
  let dropped = 0;
  for (const risk of risks) {
    const badFileRef = risk.file_refs.some((f) => !changedSet.has(normalizeBriefPath(f)));
    const badEndpointRef = risk.endpoint_refs.some((e) => !endpointSet.has(e));
    if (badFileRef || badEndpointRef) {
      dropped++;
      continue;
    }
    kept.push(risk);
  }
  return { kept, dropped };
}

/**
 * Cap the VALIDATED answer to five risks / five focus entries (AC-42) and
 * truncate the free-text fields (NFR-3). The model's own order is preserved —
 * "most important first" is expressed as data, never re-sorted here. Callers
 * apply this AFTER `validateFocus`/`validateRisks`, so a dropped entry never
 * displaces a kept one from the cap.
 */
export function capBrief(answer: BriefAnswer): BriefAnswer {
  return {
    ...answer,
    risks: answer.risks.slice(0, BRIEF_MAX_RISKS).map((r) => ({
      ...r,
      explanation: r.explanation.slice(0, BRIEF_MAX_RISK_EXPLANATION),
    })),
    review_focus: answer.review_focus.slice(0, BRIEF_MAX_FOCUS).map((f) => ({
      ...f,
      reason: f.reason.slice(0, BRIEF_MAX_FOCUS_REASON),
    })),
  };
}

/** Lowercase, collapse whitespace, strip punctuation, then compare (AC-23). */
export function isTitleRestatement(what: string, title: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const a = normalize(what);
  const b = normalize(title);
  return a.length > 0 && a === b;
}

/**
 * Replace every `SECRET_PATTERNS` match with a fixed marker (AC-24). Applied
 * to every string field of the brief, BEFORE persist, display or log — this
 * repo's first redaction surface (`rg -n redact` was empty before this file).
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}
