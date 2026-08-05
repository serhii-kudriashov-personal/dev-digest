/* SkillCard — one skill in the library rail: name, type, provenance, the global
   enabled toggle, and a usage footer.

   Deleting lives in the detail pane, not here: the card is a navigation target,
   and a destructive action on a row you are about to click is a misclick waiting
   to happen. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { formatRate } from "@/lib/format";
import { needsVetting, sourceIcon, typeColor } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={14} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>

      <div style={s.description}>{skill.description || t("card.noDescription")}</div>

      <div style={s.metaRow}>
        <Badge color={typeColor(skill.type)} mono>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <Badge color="var(--text-muted)" icon={sourceIcon(skill.source)}>
          {t(`listItem.source.${skill.source}`)}
        </Badge>
        {needsVetting(skill) && (
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>

      {/* Usage footer. `—` where there is nothing to measure yet — never 0%,
          which would read as "rejected everything" instead of "not judged". */}
      <div style={s.footer}>
        <span>{t("card.agentCount", { count: skill.used_by_count ?? 0 })}</span>
        <span style={s.footerStat}>
          {t("card.pull", { rate: formatRate(skill.pull_rate) })}
        </span>
        <span style={s.footerAccept(skill.accept_rate)}>
          {t("card.accept", { rate: formatRate(skill.accept_rate) })}
        </span>
      </div>
    </div>
  );
}
