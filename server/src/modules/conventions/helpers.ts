import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionScan,
  ConventionSkillDraft,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from './repository.js';
import { SKILL_NAME_MAX_LEN, SLUG_MAX_LEN } from './constants.js';

/**
 * Conventions extractor — pure transforms. No I/O, no SQL, no Fastify.
 *
 * The evidence gate lives here because it is the part worth testing in isolation:
 * everything the model claims passes through it, and nothing it cannot prove gets
 * a row.
 */

/** A candidate that survived the gate, with a server-computed line range. */
export interface GroundedItem {
  rule: string;
  category: ConventionCategory;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceLineStart: number;
  evidenceLineEnd: number;
  confidence: number;
}

/** What the model returns per item, before any of it is trusted. */
export interface RawItem {
  rule: string;
  category: ConventionCategory;
  evidence_path: string;
  evidence_snippet: string;
  confidence: number;
}

/** Collapse every whitespace run to one space so reindentation is not a mismatch. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/**
 * Locate `snippet` in `content` tolerating whitespace differences, and return the
 * 1-based inclusive line range it spans — or `null` when it is not there.
 *
 * Works by collapsing both sides while remembering, for each character of the
 * collapsed text, which offset of the ORIGINAL it came from. A plain
 * `collapse(content).includes(...)` can only answer yes/no; the index map is what
 * lets the real line numbers be recovered afterwards.
 */
export function locateSnippet(
  content: string,
  snippet: string,
): { start: number; end: number } | null {
  const needle = collapse(snippet).trim();
  if (needle.length === 0) return null;

  // Collapse `content` while recording the original offset behind each kept char.
  let collapsed = '';
  const originAt: number[] = [];
  let inRun = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (/\s/.test(ch)) {
      if (!inRun && collapsed.length > 0) {
        collapsed += ' ';
        originAt.push(i);
      }
      inRun = true;
      continue;
    }
    inRun = false;
    collapsed += ch;
    originAt.push(i);
  }

  const at = collapsed.indexOf(needle);
  if (at === -1) return null;

  const startOffset = originAt[at]!;
  const endOffset = originAt[Math.min(at + needle.length - 1, originAt.length - 1)]!;
  return {
    start: lineAt(content, startOffset),
    end: lineAt(content, endOffset),
  };
}

/** 1-based line number containing `offset`. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * The evidence gate. Three checks, and failing any of them DROPS the candidate:
 *
 *  1. `evidence_path` must be a file the scan actually read. A path the model
 *     invented is a claim about a file nobody opened.
 *  2. the snippet must occur in that file (whitespace collapsed).
 *  3. the line range is then computed here — never read from the model.
 *
 * A rule whose evidence does not exist is not a low-confidence rule, it is not a
 * finding. This is deliberately stricter than clamping confidence, which is what
 * the reference build did.
 */
export function groundEvidence(item: RawItem, byPath: Map<string, string>): GroundedItem | null {
  const content = byPath.get(item.evidence_path);
  if (content === undefined) return null;

  const span = locateSnippet(content, item.evidence_snippet);
  if (span === null) return null;

  return {
    rule: item.rule.trim(),
    category: item.category,
    evidencePath: item.evidence_path,
    evidenceSnippet: item.evidence_snippet,
    evidenceLineStart: span.start,
    evidenceLineEnd: span.end,
    confidence: item.confidence,
  };
}

/**
 * Comparison key for "have we already judged this rule?". Case- and
 * whitespace-insensitive, and trailing punctuation is ignored, so a re-scan that
 * rephrases the same rule as "Always use async/await." does not slip past a
 * previously rejected "always use async/await".
 */
export function ruleKey(rule: string): string {
  return collapse(rule).trim().toLowerCase().replace(/[.;:!]+$/, '');
}

/** `## <slug>` for a generated skill section. */
export function slugify(rule: string): string {
  const slug = collapse(rule)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LEN)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'convention';
}

/** `path:12-18`, or just `path` when no range was recorded. */
export function evidenceRef(row: ConventionRow): string {
  const { evidencePath, evidenceLineStart, evidenceLineEnd } = row;
  if (!evidencePath) return '';
  if (evidenceLineStart === null || evidenceLineEnd === null) return evidencePath;
  return evidenceLineStart === evidenceLineEnd
    ? `${evidencePath}:${evidenceLineStart}`
    : `${evidencePath}:${evidenceLineStart}-${evidenceLineEnd}`;
}

/**
 * Build the merged skill body from the accepted conventions.
 *
 * The severity sentence is NOT optional. A rule that does not state its own level
 * is reported as CRITICAL, and the stock `# Verdict` section makes the verdict a
 * pure function of whether any CRITICAL exists — so an unlabelled convention
 * silently turns every review into `request_changes` (root INSIGHTS.md,
 * 2026-08-02). The design mock omits it; the spec overrides the mock.
 *
 * The snippet is fenced rather than delimiter-wrapped. A skill body must never be
 * `wrapUntrusted`-wrapped — that would tell the model to ignore the rule the user
 * just accepted.
 */
export function conventionsSkillBody(repoName: string, rows: ConventionRow[]): string {
  const parts: string[] = [
    `# ${skillNameFor(repoName)}`,
    '',
    `House conventions for \`${repoName}\`, extracted from the repository and reviewed`,
    'by hand. Report a **WARNING** when a change violates any rule below, and cite the',
    'offending `file:line`.',
  ];

  for (const row of rows) {
    parts.push('', `## ${slugify(row.rule)}`, '', row.rule.trim());
    const ref = evidenceRef(row);
    if (ref && row.evidenceSnippet) {
      parts.push('', `Detected in \`${ref}\`:`, '', '```', row.evidenceSnippet.trim(), '```');
    }
  }

  return `${parts.join('\n')}\n`;
}

export function skillNameFor(repoName: string): string {
  return `${repoName}-conventions`.slice(0, SKILL_NAME_MAX_LEN);
}

/** Order sections by category, then by insertion — never by confidence. */
export function orderForSkill(rows: ConventionRow[]): ConventionRow[] {
  return [...rows].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function buildSkillDraft(repoName: string, rows: ConventionRow[]): ConventionSkillDraft {
  const ordered = orderForSkill(rows);
  const paths = [...new Set(ordered.map((r) => r.evidencePath).filter((p): p is string => !!p))];
  return {
    name: skillNameFor(repoName),
    description: `${ordered.length} house convention${ordered.length === 1 ? '' : 's'} extracted from ${repoName}`,
    type: 'convention',
    body: conventionsSkillBody(repoName, ordered),
    // Enabled by default: the accept/reject/edit loop the user just went through
    // IS the vetting step that `needsVetting` exists to enforce. See the spec.
    enabled: true,
    evidence_files: paths,
  };
}

// ----- DTO mapping -----

export function toCandidate(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    category: row.category,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_line_start: row.evidenceLineStart ?? 0,
    evidence_line_end: row.evidenceLineEnd ?? 0,
    confidence: row.confidence ?? 0,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export function toScan(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    files_sampled: row.filesSampled,
    candidates: row.candidates,
    dropped: row.dropped,
    provider: row.provider,
    model: row.model,
    created_at: row.createdAt.toISOString(),
  };
}
