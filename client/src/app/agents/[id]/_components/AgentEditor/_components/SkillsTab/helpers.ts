import type { AgentSkillLink, Skill } from "@devdigest/shared";

/**
 * The agent's attached skill ids in prompt order.
 *
 * Derived from the links on every render rather than mirrored into state — the
 * mutation writes the new order into the query cache optimistically, so this is
 * always the order the user last asked for.
 */
export function orderedSkillIds(links: AgentSkillLink[] | undefined): string[] {
  return [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id);
}

/** Move the item at `from` to `to`, returning a new array. */
export function reorder(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

/** Case-insensitive filter over a skill's name. */
export function filterByName(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => sk.name.toLowerCase().includes(q));
}

/**
 * How many of the agent's attached skills actually reach the prompt.
 *
 * Attachment is one gate and `skills.enabled` is the other: a globally disabled
 * skill stays attached and keeps its position but contributes no prompt block,
 * which is exactly what the run executor filters on.
 */
export function countReachingPrompt(attachedIds: string[], byId: Map<string, Skill>): number {
  return attachedIds.filter((id) => byId.get(id)?.enabled).length;
}
