import type { FindingRecord, Severity, SeverityCounts } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Drop low-confidence findings when the toggle is on. */
export function byConfidence(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  return hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings;
}

/**
 * Tally severities for the filter bar. Call this on the CONFIDENCE-FILTERED
 * list and never on the severity-filtered one: a chip's number then equals the
 * number of rows you get by lighting that chip alone, and it does not
 * renumber itself as you click. Accepted and dismissed findings are counted —
 * the bar reports what the review found. See specs/findings-by-severity.md.
 */
export function countBySeverity(findings: FindingRecord[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity] += 1;
  }
  return counts;
}

/**
 * Filter to the selected severities — an empty selection means "show
 * everything" — and sort worst-first.
 */
export function visibleFindings(
  findings: FindingRecord[],
  severities: Severity[],
): FindingRecord[] {
  const shown =
    severities.length > 0
      ? findings.filter((f) => severities.includes(f.severity as Severity))
      : findings;
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
