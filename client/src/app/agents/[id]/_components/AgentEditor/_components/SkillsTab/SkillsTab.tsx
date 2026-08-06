/* SkillsTab — which skills this agent gets, and in what order.

   The checkbox attaches/detaches; dragging reorders. Order is the order of the
   blocks in the assembled prompt, which is why it is editable here.

   NOTE: this component keeps NO copy of the linked list. `useSetAgentSkills`
   writes the new order into the query cache optimistically, so the rendered
   order is always derived from server state. Adding a `useState` +
   `useEffect([links])` pair here would reintroduce the "store derived state,
   then patch it" bug that client/INSIGHTS.md records as CRITICAL. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useAgentSkillLinks, useSetAgentSkills, useSkills } from "@/lib/hooks/skills";
import { countReachingPrompt, filterByName, orderedSkillIds, reorder } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("skills");
  const { data: skills, isLoading: skillsLoading } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkillLinks(agentId);
  const setSkills = useSetAgentSkills();

  const [search, setSearch] = React.useState("");
  // Ephemeral drag state — which row is being dragged and where it currently
  // hovers. This is UI state, not a copy of anything the server owns.
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  if (skillsLoading || linksLoading) return <Skeleton height={200} />;

  const library = skills ?? [];
  const byId = new Map(library.map((sk) => [sk.id, sk]));
  const attachedIds = orderedSkillIds(links).filter((id) => byId.has(id));
  const attachedSet = new Set(attachedIds);

  const save = (skillIds: string[]) => setSkills.mutate({ agentId, skillIds });

  const toggle = (skillId: string) =>
    save(
      attachedSet.has(skillId)
        ? attachedIds.filter((id) => id !== skillId)
        : [...attachedIds, skillId],
    );

  const endDrag = () => {
    if (dragFrom !== null && dragOver !== null) {
      const next = reorder(attachedIds, dragFrom, dragOver);
      if (next !== attachedIds) save(next);
    }
    setDragFrom(null);
    setDragOver(null);
  };

  const available = filterByName(
    library.filter((sk) => !attachedSet.has(sk.id)),
    search,
  );

  if (library.length === 0) return <div style={s.hint}>{t("agentTab.empty")}</div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("page.heading")}</h2>
        <Badge color="var(--text-secondary)">
          {t("agentTab.count", {
            enabled: countReachingPrompt(attachedIds, byId),
            total: library.length,
          })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={12} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("agentTab.filterPlaceholder")}
            style={s.searchInput}
            aria-label={t("agentTab.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("agentTab.orderHint")}</p>

      {attachedIds.length > 0 && (
        <div>
          <div style={s.sectionLabel}>{t("agentTab.attached")}</div>
          {attachedIds.map((skillId, idx) => {
            const sk = byId.get(skillId) as Skill;
            return (
              <div
                key={skillId}
                draggable
                onDragStart={() => setDragFrom(idx)}
                onDragEnter={() => setDragOver(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={endDrag}
                onDrop={endDrag}
                style={s.row({
                  attached: true,
                  dragging: dragFrom === idx,
                  // Attached but globally disabled: still ordered, still listed,
                  // but it contributes no block to the prompt.
                  dimmed: !sk.enabled,
                })}
              >
                <span style={s.handle} title={t("agentTab.dragHandle")}>
                  <Icon.Menu size={13} />
                </span>
                <Checkbox checked onChange={() => toggle(skillId)} />
                <span className="mono" style={s.name}>
                  {sk.name}
                </span>
                {!sk.enabled && (
                  <Badge color="var(--text-muted)">{t("agentTab.disabledGlobally")}</Badge>
                )}
                <Badge color="var(--text-secondary)" mono>
                  {t(`listItem.type.${sk.type}`)}
                </Badge>
                <span style={s.order}>{idx + 1}</span>
              </div>
            );
          })}
        </div>
      )}

      {available.length > 0 && (
        <div>
          <div style={s.sectionLabel}>{t("agentTab.available")}</div>
          {available.map((sk) => (
            <div
              key={sk.id}
              style={s.row({ attached: false, dragging: false, dimmed: !sk.enabled })}
            >
              <span style={s.handleSpacer} />
              <Checkbox checked={false} onChange={() => toggle(sk.id)} />
              <span className="mono" style={s.name}>
                {sk.name}
              </span>
              <Badge color="var(--text-secondary)" mono>
                {t(`listItem.type.${sk.type}`)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
