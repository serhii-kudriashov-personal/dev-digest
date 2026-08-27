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

/** Fixed palette a lane's accent is drawn from — reuses existing severity/
 *  status tokens rather than introducing new colours, so a lane's accent
 *  always matches the theme (light/dark) automatically. Purely decorative:
 *  it carries no meaning about the agent (AC-47 only binds status). */
const LANE_ACCENT_PALETTE = ["var(--crit)", "var(--warn)", "var(--accent)", "var(--ok)"] as const;

/** Deterministic accent colour for a lane, keyed on the agent's identity so
 *  the same agent gets the same colour across renders and reloads. */
export function laneAccentColor(agentId: string | null, agentName: string): string {
  const key = agentId ?? agentName;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return LANE_ACCENT_PALETTE[hash % LANE_ACCENT_PALETTE.length] ?? LANE_ACCENT_PALETTE[0];
}
