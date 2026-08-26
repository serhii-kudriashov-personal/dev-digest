/* Findings overlay for the DiffViewer.

   Pure helpers plus the API shape the viewer needs, deliberately mirroring
   `comments.ts`: both are OPTIONAL overlays a caller may thread through
   DiffViewer → FileCard → CodeLine, and neither is required for the plain diff
   to render.

   Findings are review output, so they are read-only here — the overlay adds a
   chip and a border, never an editor. */
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FINDING_PATH_PREFIX_RE, SEVERITY_RANK } from "./constants";
import type { Line } from "./helpers";

/** What the viewer needs to render findings on a diff. */
export interface DiffFindingsApi {
  findings: FindingRecord[];
  /** Called when the reader clicks a finding chip (e.g. to open the panel). */
  onFindingClick?: (finding: FindingRecord) => void;
}

/**
 * Strip the `./`, `a/` and `b/` prefixes a unified diff adds. `finding.file` is
 * model-authored and sometimes carries one; `PrFile.path` never does. Same
 * normalization the server applies before it counts a file's finding lines, so
 * the chips and the smart-diff badge agree.
 */
function normalizePath(path: string): string {
  return path.replace(FINDING_PATH_PREFIX_RE, "");
}

/** This file's findings. Exact path match — no basename fallback. */
export function findingsForFile(path: string, findings: FindingRecord[]): FindingRecord[] {
  const target = normalizePath(path);
  return findings.filter((f) => normalizePath(f.file) === target);
}

/**
 * The findings ANCHORED to this line — the ones whose `start_line` is this row.
 * Each renders a chip; a multi-line finding shows its chip once, at its head.
 */
export function findingsForLine(ln: Line, fileFindings: FindingRecord[]): FindingRecord[] {
  if (ln.newNo == null) return [];
  return fileFindings.filter((f) => f.start_line === ln.newNo);
}

/**
 * The severity of the most serious finding whose range COVERS this line, or
 * null. This is what tints the left border, so a finding spanning ten lines
 * marks all ten while showing one chip.
 */
export function severityForLine(ln: Line, fileFindings: FindingRecord[]): Severity | null {
  const line = ln.newNo;
  if (line == null) return null;
  let worst: Severity | null = null;
  for (const f of fileFindings) {
    if (line < f.start_line || line > Math.max(f.end_line, f.start_line)) continue;
    if (worst === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst]) worst = f.severity;
  }
  return worst;
}
