import type { AgentLane } from "@devdigest/shared";

/** Seconds-formatted duration, or an em dash for "not yet known" (never `0`,
 *  root `INSIGHTS.md` 2026-08-02). `total_duration_ms` is `null` until every
 *  member run has settled (AC-31). */
export function formatDurationSeconds(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** True when every lane in the run reached a terminal failure state and none
 *  completed — the "every agent failed" state (AC-34, Edge case row 2),
 *  distinct from a run still in flight (queued/running lanes present) and
 *  from a completed run that simply found nothing (`noFindingsAtAll` below). */
export function allLanesFailed(lanes: AgentLane[]): boolean {
  return lanes.length > 0 && lanes.every((l) => l.status === "failed" || l.status === "cancelled");
}

/** True when at least one lane completed and none of the completed lanes
 *  produced a finding — AC-45's "the agents found nothing", which must read
 *  differently from both "no run yet" and "every agent failed". */
export function noFindingsAtAll(lanes: AgentLane[]): boolean {
  const completed = lanes.filter((l) => l.status === "done");
  return completed.length > 0 && completed.every((l) => l.findings_total === 0);
}
