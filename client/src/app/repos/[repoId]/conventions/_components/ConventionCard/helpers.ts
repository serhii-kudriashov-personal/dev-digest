import type { ConventionCandidate } from "@devdigest/shared";
import { HIGH_CONFIDENCE, LOW_CONFIDENCE } from "./constants";

/**
 * Colour for the confidence meter.
 *
 * This is the ONLY thing confidence is allowed to drive. It is not calibrated —
 * the model reports 1.0 for hallucinations as readily as for correct claims — so
 * it never sorts, filters, hides or auto-accepts a candidate (root INSIGHTS.md,
 * 2026-08-02).
 */
export function confidenceColor(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE) return "var(--ok)";
  if (confidence >= LOW_CONFIDENCE) return "var(--warn)";
  return "var(--crit)";
}

/** `src/api/users.ts:23-31`, collapsing a single-line span to `:23`. */
export function evidenceRef(c: ConventionCandidate): string {
  if (!c.evidence_path) return "";
  const { evidence_line_start: start, evidence_line_end: end } = c;
  if (!start) return c.evidence_path;
  return start === end ? `${c.evidence_path}:${start}` : `${c.evidence_path}:${start}-${end}`;
}

export function copySnippet(snippet: string): void {
  void navigator.clipboard?.writeText(snippet);
}

/**
 * GitHub blob URL for a candidate's evidence, with the line range as an anchor.
 *
 * Pinned to the repo's default branch, not to a commit — so the file always opens,
 * but the `#L` anchor drifts once those lines move. That is the honest trade for
 * not storing a sha per candidate: the range was computed against the clone as it
 * stood at scan time, and nothing records which commit that was. If the anchor
 * ever needs to be permanent, add `conventions.head_sha` and prefer it here — the
 * change is additive, since a missing sha falls back to this.
 *
 * Returns null when there is nothing safe to link: no repo loaded yet, or no path.
 */
export function githubBlobUrl(
  c: ConventionCandidate,
  repo: { full_name: string; default_branch: string } | undefined,
): string | null {
  if (!repo || !c.evidence_path) return null;
  const base = `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${c.evidence_path}`;
  const { evidence_line_start: start, evidence_line_end: end } = c;
  // A range the gate could not compute is stored as 0 — link the file, not `#L0`.
  if (!start) return base;
  return start === end ? `${base}#L${start}` : `${base}#L${start}-L${end}`;
}
