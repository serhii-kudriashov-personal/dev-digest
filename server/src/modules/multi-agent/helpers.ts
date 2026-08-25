/**
 * Pure transforms for the multi-agent review slice (SPEC-05) — zero I/O, no
 * `Db`, no `Container`, no `fastify` (`backend-onion-architecture` §1, §8).
 */
import type { AgentLane, FindingRecord, GroupedLocation, LocationStance, Severity } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';

export interface LineRange {
  start_line: number;
  end_line: number;
}

/**
 * Inclusive line-range overlap. DUPLICATED VERBATIM from the `eval` slice's
 * `helpers.ts:35` (`overlaps`) — that file is `SLICE_PRIVATE`, so importing it
 * here would fail `no-cross-slice-import` (`server/INSIGHTS.md` 2026-08-17).
 * Same precedent as that file's own `labelSkillBodies`, duplicated from the
 * `reviews` slice's `helpers.ts` for the same reason.
 */
export function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

/**
 * Map a persisted findings row to the wire `FindingRecord` this slice serves.
 * Not delegated to `modules/reviews/helpers.ts#findingRowToDto` — same
 * `SLICE_PRIVATE` reason as `overlaps` above. Kept byte-for-byte equivalent to
 * that function (plus `learned_at`) by hand.
 */
export function findingRowToRecord(row: FindingRow): FindingRecord {
  return {
    id: row.id,
    severity: row.severity as FindingRecord['severity'],
    category: row.category as FindingRecord['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as FindingRecord['kind']) ?? 'finding',
    trifecta_components: (row.trifectaComponents as FindingRecord['trifecta_components']) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
    learned_at: row.learnedAt?.toISOString() ?? null,
  };
}

/**
 * Deterministic tie-break when one agent's findings collapse into a single
 * stance (below): report the MOST SEVERE one. The plan does not name this
 * rule explicitly; it is needed because `isConflict` compares exactly one
 * severity per stance, and is recorded here so the choice is visible.
 */
const SEVERITY_RANK: Record<Severity, number> = { SUGGESTION: 0, WARNING: 1, CRITICAL: 2 };

interface FlatFinding {
  runId: string;
  agentId: string | null;
  agentName: string;
  findingId: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
}

/**
 * Bucket every COMPLETED lane's findings into file:line-range locations
 * (AC-21), one `LocationStance` per completed lane per location (AC-24). A
 * location flagged only by a lane that later failed never appears — only
 * `status === 'done'` lanes are considered, which is what keeps the "agent
 * whose run failed" edge case out of the panel entirely.
 */
export function groupFindings(lanes: AgentLane[]): GroupedLocation[] {
  const completed = lanes.filter((l) => l.status === 'done');

  const flat: FlatFinding[] = [];
  for (const lane of completed) {
    for (const f of lane.findings) {
      flat.push({
        runId: lane.run_id,
        agentId: lane.agent_id,
        agentName: lane.agent_name,
        findingId: f.id,
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        severity: f.severity,
      });
    }
  }
  // Deterministic bucketing order (NFR-5): sort BEFORE bucketing so the result
  // never depends on the order lanes/findings happened to arrive in.
  flat.sort(
    (a, b) => a.file.localeCompare(b.file) || a.start_line - b.start_line || a.end_line - b.end_line,
  );

  interface Bucket {
    file: string;
    start_line: number;
    end_line: number;
    findings: FlatFinding[];
  }
  const buckets: Bucket[] = [];
  for (const f of flat) {
    const bucket = buckets.find(
      (b) => b.file === f.file && overlaps({ start_line: b.start_line, end_line: b.end_line }, f),
    );
    if (bucket) {
      bucket.start_line = Math.min(bucket.start_line, f.start_line);
      bucket.end_line = Math.max(bucket.end_line, f.end_line);
      bucket.findings.push(f);
    } else {
      buckets.push({ file: f.file, start_line: f.start_line, end_line: f.end_line, findings: [f] });
    }
  }

  const locations: GroupedLocation[] = buckets.map((b) => {
    const stances: LocationStance[] = completed.map((lane) => {
      // Two findings from the SAME agent collapse into ONE stance carrying
      // both ids — an agent never disagrees with itself (spec §Edge cases).
      const own = b.findings.filter((f) => f.runId === lane.run_id);
      if (own.length === 0) {
        return {
          agent_id: lane.agent_id,
          agent_name: lane.agent_name,
          run_id: lane.run_id,
          flagged: false,
          severity: null,
          finding_ids: [],
        };
      }
      const worst = own.reduce((a, c) =>
        SEVERITY_RANK[c.severity] > SEVERITY_RANK[a.severity] ? c : a,
      );
      return {
        agent_id: lane.agent_id,
        agent_name: lane.agent_name,
        run_id: lane.run_id,
        flagged: true,
        severity: worst.severity,
        finding_ids: own.map((f) => f.findingId),
      };
    });
    return {
      file: b.file,
      start_line: b.start_line,
      end_line: b.end_line,
      stances,
      conflict: isConflict(stances),
    };
  });

  // Sort locations by file then start_line — deterministic and never
  // reshuffling (`server/INSIGHTS.md` 2026-08-21).
  locations.sort((a, b) => a.file.localeCompare(b.file) || a.start_line - b.start_line);
  return locations;
}

/**
 * A location is a conflict when at least one completed agent did NOT flag it,
 * or when the flagged agents disagree on severity (AC-26). Never reads
 * `confidence` — that field is unverified model output, never a signal
 * (root `INSIGHTS.md` 2026-08-02).
 */
export function isConflict(stances: LocationStance[]): boolean {
  if (stances.some((s) => !s.flagged)) return true;
  const severities = new Set(stances.filter((s) => s.flagged).map((s) => s.severity));
  return severities.size > 1;
}

/**
 * `total_duration_ms` is the sum of every lane's duration ONLY once every lane
 * has settled (done/failed/cancelled) — while one is still queued/running the
 * total is unknowable, so it is `null`, never a partial sum (AC-31).
 * `total_cost_usd` sums the known costs and is `null` only when every one is
 * unknown (AC-32) — unknown cost is never `0` (root `INSIGHTS.md` 2026-08-02).
 */
export function runTotals(lanes: AgentLane[]): {
  total_duration_ms: number | null;
  total_cost_usd: number | null;
} {
  const settled = lanes.every(
    (l) => l.status === 'done' || l.status === 'failed' || l.status === 'cancelled',
  );
  const total_duration_ms = settled ? lanes.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0) : null;
  const knownCosts = lanes.map((l) => l.cost_usd).filter((c): c is number => c != null);
  const total_cost_usd = knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null;
  return { total_duration_ms, total_cost_usd };
}
