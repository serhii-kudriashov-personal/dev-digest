import type { IconName } from "@devdigest/ui";
import type { AgentLane as AgentLaneRecord } from "@devdigest/shared";

/** Status → icon + colour token. Icon-plus-text is what makes lane status
 *  identifiable without colour (AC-47) — colour alone is never the carrier. */
export const STATUS_ICON: Record<AgentLaneRecord["status"], IconName> = {
  queued: "Clock",
  running: "RefreshCw",
  done: "CheckCircle",
  failed: "XCircle",
  cancelled: "Slash",
};

export const STATUS_COLOR: Record<AgentLaneRecord["status"], string> = {
  queued: "var(--text-muted)",
  running: "var(--accent)",
  done: "var(--ok)",
  failed: "var(--crit)",
  cancelled: "var(--text-muted)",
};

const VERDICT_COLOR: Record<string, string> = {
  request_changes: "var(--crit)",
  comment: "var(--warn)",
  approve: "var(--ok)",
};

export function verdictColor(verdict: string | null): string {
  return verdict ? (VERDICT_COLOR[verdict] ?? "var(--text-muted)") : "var(--text-muted)";
}
