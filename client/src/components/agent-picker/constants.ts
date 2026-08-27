import type { IconName } from "@devdigest/ui";

/** Constants for AgentPicker. */

/** The checkbox list scrolls past this height instead of pushing the confirm
 *  button off screen in a workspace with many agents. */
export const LIST_MAX_HEIGHT = 260;

/** Fixed accent + icon pairs a row's card is drawn from — reuses existing
 *  severity/status colour tokens rather than new ones, so it matches the
 *  theme (light/dark) automatically. Purely decorative: it carries no
 *  meaning about the agent, same convention as
 *  `multi-agent/_components/AgentLane/constants.ts`'s lane accent (duplicated
 *  rather than shared across this cross-route boundary, `frontend-ui-architecture`
 *  §2). */
const AGENT_ACCENT_PALETTE: readonly { color: string; icon: IconName }[] = [
  { color: "var(--crit)", icon: "Shield" },
  { color: "var(--warn)", icon: "Zap" },
  { color: "var(--accent)", icon: "Lightbulb" },
  { color: "var(--ok)", icon: "Users" },
] as const;

/** Deterministic accent + icon for an agent, keyed on its id so the same
 *  agent gets the same look across renders and reloads. */
export function agentAccent(agentId: string): { color: string; icon: IconName } {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  return AGENT_ACCENT_PALETTE[hash % AGENT_ACCENT_PALETTE.length] ?? { color: "var(--accent)", icon: "Cpu" };
}
