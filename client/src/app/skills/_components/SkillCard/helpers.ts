import type { IconName } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";

/** Badge colour per skill type, so the library scans by kind at a glance. */
const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent-text)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

export function typeColor(type: SkillType): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.custom;
}

/**
 * Icon per provenance. Shown on every card, because where a body came from is
 * the thing the user has to judge before enabling it — the body becomes
 * instructions in the agent's prompt.
 */
const SOURCE_ICONS: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Sparkles",
  community: "Globe",
  imported_url: "Upload",
};

export function sourceIcon(source: SkillSource): IconName {
  return SOURCE_ICONS[source] ?? "Edit";
}

/**
 * True when the skill's body came from outside this workspace AND has not been
 * vouched for yet.
 *
 * Deliberately narrower than "source !== manual": the source badge already
 * states provenance on every card, so repeating it as a warning would be noise.
 * What earns a warning is the combination the import flow creates — someone
 * else's instructions, not yet enabled by a human.
 */
export function needsVetting(skill: Skill): boolean {
  return skill.source !== "manual" && !skill.enabled;
}
