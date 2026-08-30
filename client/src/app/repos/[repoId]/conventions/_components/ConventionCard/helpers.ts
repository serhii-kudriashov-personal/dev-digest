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
