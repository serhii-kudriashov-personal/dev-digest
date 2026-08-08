import type { PrIntentRecord } from '@devdigest/shared';
import {
  MAX_COMMIT_MESSAGE_CHARS,
  MAX_HUNK_HEADERS,
  MAX_LINKED_ISSUES,
  MAX_LINKED_SPECS,
  SUBSTANTIVE_BODY_CHARS,
  type SourceLabel,
} from './constants.js';

/**
 * Intent slice — pure transforms. No DB, no network, no container, no `this`.
 *
 * Three of these are security controls rather than conveniences, and are
 * unit-tested as such: `hunkHeaders` is where "diff bodies are never sent" is
 * enforced, `linkedSpecPaths` is the allowlist standing between a PR body and
 * the filesystem, and `validateClassification` refuses to record a source the
 * model was never actually shown.
 */

/**
 * The `@@ … @@` header lines of a patch, and NOTHING else.
 *
 * THIS FUNCTION IS THE ENFORCEMENT POINT for "diff bodies are never sent to the
 * classifier". It matches only the header form, so no `+`, `-` or context line
 * can pass through it — and the cap is on the number of HEADERS, never a
 * truncation of the patch, because a truncated patch is still patch content.
 */
export function hunkHeaders(patch: string | null): string[] {
  if (!patch) return [];
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    // A hunk header opens with `@@ ` and closes the range with ` @@`.
    if (/^@@ .* @@/.test(line)) {
      // Keep only through the closing `@@` — the trailing section heading git
      // appends is source code copied out of the file.
      const end = line.indexOf('@@', 2);
      out.push(end === -1 ? line : line.slice(0, end + 2));
      if (out.length >= MAX_HUNK_HEADERS) break;
    }
  }
  return out;
}

/**
 * Issue numbers CLOSED by this PR, per GitHub's nine documented keyword stems.
 *
 * Deliberately stricter than the adapter's regex at `adapters/github/octokit.ts`
 * (which makes the keyword optional and checks three of the nine, so
 * `see #12 for context` resolves as a closing link). That one is left alone — it
 * has other consumers — so this slice carries its own parser.
 */
export function linkedIssueNumbers(body: string | null): number[] {
  if (!body) return [];
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]+#(\d+)/gi;
  const out: number[] = [];
  for (const m of body.matchAll(re)) {
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    if (out.includes(n)) continue;
    out.push(n);
    if (out.length >= MAX_LINKED_ISSUES) break;
  }
  return out;
}

/**
 * Repo-relative plan/spec paths mentioned in a PR body.
 *
 * These strings are attacker-controlled and are fed to `git.readFile`, so the
 * rule is an ALLOWLIST, not a blacklist: the extension must be `.md`/`.mdx`, and
 * anything with `..`, a leading `/`, a `~`, a URL scheme, a backslash, a NUL or
 * a control character is rejected outright. `path.basename` is deliberately not
 * used — a relative subdirectory (`docs/plans/x.md`) is legitimate, so the
 * traversal has to be rejected rather than stripped.
 */
export function linkedSpecPaths(body: string | null): string[] {
  if (!body) return [];
  const out: string[] = [];
  // Markdown links `[x](path)` and backticked `path` — the two ways a path is
  // written in practice. Bare words are not followed: too many false positives.
  const candidates = [
    ...[...body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const p = raw.trim();
    if (!isSafeSpecPath(p)) continue;
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= MAX_LINKED_SPECS) break;
  }
  return out;
}

/** The allowlist itself, exported so the test can state it directly. */
export function isSafeSpecPath(p: string): boolean {
  if (p.length === 0 || p.length > 300) return false;
  if (!/\.mdx?$/i.test(p)) return false;
  if (p.includes('..')) return false; // traversal
  if (p.startsWith('/') || p.startsWith('~')) return false; // absolute / home
  if (p.includes('\\')) return false; // windows-style separators
  if (/[\x00-\x1f\x7f]/.test(p)) return false; // NUL + control chars
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false; // any URL scheme
  if (p.startsWith('//')) return false; // protocol-relative
  // Positive shape: repo-relative segments only.
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(p);
}

/**
 * The DETERMINISTIC confidence tier — computed from which sources were really
 * present, never from what the model says about itself.
 *
 * Verbalized LLM confidence is systematically overconfident (models rate their
 * own answers up to 26% higher than the same answer attributed elsewhere), and
 * this repo has already measured `findings.confidence` returning 1.0 for a
 * hallucination. So the model's number is stored and the UI shows this one.
 */
export function deterministicConfidence(
  sources: SourceLabel[],
  opts: { substantiveBody: boolean },
): 'high' | 'medium' | 'low' {
  const documented = sources.includes('linked_issue') || sources.includes('linked_spec');
  if (documented && opts.substantiveBody) return 'high';
  if (documented || opts.substantiveBody) return 'medium';
  // Only indirect signals (hunk headers, commit messages) — the PR is
  // undocumented, and the derived intent is a guess from shape alone.
  return 'low';
}

/** Whether a PR body carries enough text to say anything about intent. */
export function isSubstantiveBody(body: string | null): boolean {
  return (body ?? '').trim().length >= SUBSTANTIVE_BODY_CHARS;
}

/** Trim a commit message to its subject line, capped. */
export function commitSubject(message: string): string {
  return (message.split('\n')[0] ?? '').trim().slice(0, MAX_COMMIT_MESSAGE_CHARS);
}

/**
 * Keep only the `evidence_used` labels that were ACTUALLY put in the prompt,
 * and report the rest instead of swallowing them.
 *
 * Same discipline as `resolveSkillAttribution` and `grounding.ts`: what the
 * model claims about its own inputs is a claim, not data. Logging the rejects
 * matters because a model that mis-attributes systematically must not look like
 * one that simply never attributes.
 */
export function validateClassification(
  claimed: readonly string[],
  presented: readonly SourceLabel[],
): { sources: SourceLabel[]; rejected: string[] } {
  const allowed = new Set<string>(presented);
  const sources: SourceLabel[] = [];
  const rejected: string[] = [];
  for (const label of claimed) {
    if (allowed.has(label) && !sources.includes(label as SourceLabel)) {
      sources.push(label as SourceLabel);
    } else if (!allowed.has(label)) {
      rejected.push(label);
    }
  }
  return { sources, rejected };
}

/**
 * The plain-text block the engine wraps as `<untrusted source="intent">`.
 *
 * Names the confidence tier and the source LABELS. It never embeds spec text,
 * issue text or hunk content — those were inputs to the classifier, not
 * something to relay into a second model's prompt.
 */
export function renderIntentBlock(record: PrIntentRecord): string | null {
  const intent = record.intent?.trim();
  if (!intent) return null;
  const lines = [intent];
  if (record.in_scope.length > 0) {
    lines.push('', 'In scope:', ...record.in_scope.map((s) => `- ${s}`));
  }
  if (record.out_of_scope.length > 0) {
    lines.push('', 'Explicitly out of scope (as stated by the author):');
    lines.push(...record.out_of_scope.map((s) => `- ${s}`));
  }
  const meta: string[] = [];
  if (record.confidence) meta.push(`confidence: ${record.confidence}`);
  if (record.sources && record.sources.length > 0) {
    meta.push(`derived from: ${record.sources.join(', ')}`);
  }
  if (meta.length > 0) lines.push('', `(${meta.join('; ')})`);
  return lines.join('\n');
}
