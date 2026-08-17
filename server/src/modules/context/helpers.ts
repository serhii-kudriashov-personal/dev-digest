import {
  CONTEXT_DOC_EXT,
  MAX_DOCS_PER_AGENT,
  MAX_DOCUMENT_CHARS,
  MAX_ROOT_EXPANSIONS,
} from './constants.js';

/**
 * Project Context (SPEC-01) — pure transforms.
 *
 * No I/O, no DB, no container: everything here takes plain data and returns
 * plain data, so the walker, the service and the run-time read path all share
 * one testable definition of "does this path match", "is this path safe" and
 * "which documents does this agent effectively inject".
 *
 * The glob matcher is HAND-WRITTEN. No glob dependency is added — this change
 * adds no dependency in any package, and the subset needed here (`**`, `*`,
 * `?`, `{a,b}`) is small enough to state, test and reason about.
 */

// ---------------------------------------------------------------- glob matching

/** Expand `{a,b}` alternations into concrete patterns, innermost group first. */
function expandBraces(pattern: string, budget = { left: MAX_ROOT_EXPANSIONS }): string[] {
  const open = pattern.indexOf('{');
  if (open < 0) return [pattern];

  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === '{') depth += 1;
    else if (pattern[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  // Unbalanced brace: treat the pattern literally rather than guessing.
  if (close < 0) return [pattern];

  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);

  const parts: string[] = [];
  let nested = 0;
  let current = '';
  for (const ch of pattern.slice(open + 1, close)) {
    if (ch === '{') nested += 1;
    if (ch === '}') nested -= 1;
    if (ch === ',' && nested === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const out: string[] = [];
  for (const part of parts) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    out.push(...expandBraces(head + part + tail, budget));
  }
  return out;
}

/** One path segment (no `/`) as a regex source. `*` and `?` never cross a `/`. */
function segmentToRegex(segment: string): string {
  let out = '';
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/**
 * Compile a brace-free glob to an anchored RegExp over a posix relative path.
 *
 * `**` matches zero or more whole segments, which is what makes a root
 * depth-agnostic: `**​/docs/**​/*.md` matches both `docs/x.md` and
 * `packages/foo/docs/bar.md`.
 */
function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let source = '^';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segmentToRegex(segment);
    if (!last) source += '/';
  });
  return new RegExp(`${source}$`);
}

/**
 * The human label for a root: its last LITERAL directory segment, which is what
 * the list renders as the document's root badge (AC-4). `**​/docs/**​/*.md` is
 * labelled `docs`; a pattern with no literal segment is its own label.
 */
function labelForPattern(pattern: string): string {
  const segments = pattern.split('/').filter((s) => s.length > 0);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]!;
    const isFile = i === segments.length - 1;
    if (isFile) continue; // the trailing `*.md` names the file, not the root
    if (!/[*?]/.test(segment)) return segment;
  }
  return pattern;
}

interface CompiledRoot {
  label: string;
  re: RegExp;
}

/** Compile the configured roots once; `matchesRoots` walks them in order. */
export function compileRoots(roots: readonly string[]): CompiledRoot[] {
  const out: CompiledRoot[] = [];
  for (const root of roots) {
    const trimmed = root.trim();
    if (trimmed.length === 0) continue;
    for (const expanded of expandBraces(trimmed)) {
      out.push({ label: labelForPattern(expanded), re: globToRegExp(expanded) });
    }
  }
  return out;
}

/**
 * The label of the FIRST configured root matching `relPath`, or `null`.
 *
 * First-match, not every-match: a document reachable through two overlapping
 * roots is listed once and labelled once (AC-5).
 */
export function matchesRoots(relPath: string, roots: readonly string[]): string | null {
  return matchesCompiledRoots(relPath, compileRoots(roots));
}

/** `matchesRoots` against roots compiled once — the walker's hot path. */
export function matchesCompiledRoots(relPath: string, compiled: CompiledRoot[]): string | null {
  for (const root of compiled) {
    if (root.re.test(relPath)) return root.label;
  }
  return null;
}

// ---------------------------------------------------------------- path safety

/**
 * The path allowlist between a STORED path and `readFile` (AC-42).
 *
 * A COPY of `isSafeSpecPath` (`modules/intent/helpers.ts:98-109`) with the
 * extension test tightened from `/\.mdx?$/i` to `.md` only. Copied and not
 * imported on purpose: `intent/helpers.ts` matches `SLICE_PRIVATE`
 * (`server/.dependency-cruiser.cjs:65`), so importing it fires
 * `no-cross-slice-import`.
 *
 * The last line is a POSITIVE shape test, and it is what actually makes this an
 * allowlist — the rejections above it are cheap early exits with better
 * intent, not the defence. A blacklist alone is not equivalent.
 */
export function isSafeContextPath(p: string): boolean {
  if (p.length === 0 || p.length > 300) return false;
  if (!p.toLowerCase().endsWith(CONTEXT_DOC_EXT)) return false;
  if (p.includes('..')) return false; // traversal
  if (p.startsWith('/') || p.startsWith('~')) return false; // absolute / home
  if (p.includes('\\')) return false; // windows-style separators
  if (/[\x00-\x1f\x7f]/.test(p)) return false; // NUL + control chars
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false; // any URL scheme
  if (p.startsWith('//')) return false; // protocol-relative
  // Positive shape: repo-relative segments only.
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(p);
}

// ---------------------------------------------------------------- attachments

/** First occurrence wins — the ordering rule behind AC-5 and AC-21. */
export function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export interface OrderedDoc {
  path: string;
  order: number;
}

export interface EffectiveDocs {
  /** What the run will try to read, in injection order. */
  injected: string[];
  /** Everything past `MAX_DOCS_PER_AGENT`, recorded as `over_limit` (AC-33). */
  overflow: string[];
}

/**
 * Merge an agent's direct attachments with the ones it inherits from its
 * enabled skills.
 *
 * Direct first, then inherited (AC-20). A path reached both ways keeps its
 * DIRECT position and appears once (AC-21). The surplus past the cap is
 * returned rather than dropped, so the run can record why it was not read.
 */
export function resolveEffectiveDocs(
  direct: readonly OrderedDoc[],
  inherited: readonly OrderedDoc[],
): EffectiveDocs {
  const byOrder = (a: OrderedDoc, b: OrderedDoc) => a.order - b.order;
  const ordered = [
    ...[...direct].sort(byOrder).map((d) => d.path),
    ...[...inherited].sort(byOrder).map((d) => d.path),
  ];
  const unique = dedupePaths(ordered);
  return {
    injected: unique.slice(0, MAX_DOCS_PER_AGENT),
    overflow: unique.slice(MAX_DOCS_PER_AGENT),
  };
}

/**
 * Hard cut at `MAX_DOCUMENT_CHARS` (NFR-5, AC-16). The token estimate shown in
 * the UI is computed over THIS text, not the original, so the number the user
 * reads is the number the prompt pays.
 */
export function truncateForInjection(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true };
}
