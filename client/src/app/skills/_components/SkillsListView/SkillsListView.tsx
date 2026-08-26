/* /skills — the skill library, master-detail.

   Rail of skill cards on the left, the selected skill's five-tab detail on the
   right. Both /skills and /skills/:id render this: the rail is identical, and the
   route only decides what the right-hand side shows. Same shape as the Agents
   editor so the two Skills-Lab screens read as one layout. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportDrawer } from "../ImportDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView({
  selectedId,
  children,
}: {
  /** The skill the route selected, if any. */
  selectedId?: string;
  /** The detail pane for `selectedId` — supplied by /skills/[id]. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();

  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const list = filterSkills(skills ?? [], search);
  const selected = (skills ?? []).find((sk) => sk.id === selectedId);
  const open = (skill: Skill) => router.push(`/skills/${skill.id}?tab=config`);

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), ...(selectedId ? { href: "/skills" } : {}) },
    ...(selected ? [{ label: selected.name }] : []),
  ];

  return (
    <AppShell crumb={crumb}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={open} />}
      {importing && <ImportDrawer onClose={() => setImporting(false)} onImported={open} />}
      <div style={s.layout}>
        <div style={s.rail}>
          <div style={s.railHeader}>
            <div style={s.railHeaderRow}>
              <h1 style={s.railTitle}>{t("page.heading")}</h1>
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
                  {
                    label: t("page.menu.fromFile"),
                    icon: "Upload",
                    onClick: () => setImporting(true),
                  },
                ]}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={12} style={s.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
                aria-label={t("page.searchPlaceholder")}
              />
            </div>
          </div>

          <div style={s.railList}>
            {isLoading && (
              <>
                <Skeleton height={104} />
                <Skeleton height={104} />
                <Skeleton height={104} />
              </>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setImporting(true)}
              />
            )}
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                onClick={() => open(sk)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {children ?? (
          <div style={s.emptyPane}>
            <EmptyState
              icon="Sparkles"
              title={t("page.selectPrompt.title")}
              body={t("page.selectPrompt.body")}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
