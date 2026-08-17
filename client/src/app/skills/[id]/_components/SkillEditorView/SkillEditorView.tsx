/* SkillEditorView — the detail pane of /skills/:id.

   Rendered inside SkillsListView's rail layout, so the library stays visible
   while a skill is open. Tab state lives in `?tab=`, matching the Agents editor. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useSkill } from "@/lib/hooks/skills";
import { SkillsListView } from "@/app/skills/_components/SkillsListView";
import { needsVetting, typeColor } from "@/app/skills/_components/SkillCard";
import { ConfigTab } from "../ConfigTab";
import { ContextTab } from "../ContextTab";
import { EvalsTab } from "../EvalsTab";
import { PreviewTab } from "../PreviewTab";
import { StatsTab } from "../StatsTab";
import { VersionsTab } from "../VersionsTab";
import { DEFAULT_TAB, TABS, VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillEditorView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  return (
    <SkillsListView selectedId={id}>
      <div style={s.pane}>
        {isError || (!isLoading && !skill) ? (
          <ErrorState
            fullScreen
            title={t("editor.notFound.title")}
            body={error instanceof ApiError ? error.message : t("editor.loadError")}
            onRetry={() => refetch()}
          />
        ) : isLoading || !skill ? (
          <div style={s.loading}>
            <Skeleton height={26} width={260} />
            <Skeleton height={220} />
          </div>
        ) : (
          <>
            <Header skill={skill} />
            <div style={s.tabsBar}>
              <Tabs
                tabs={TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }))}
                value={tab}
                onChange={setTab}
                pad="0 24px"
              />
            </div>
            <div style={s.body}>
              {/* `key` is load-bearing on the tabs that hold form state: they are
                  uncontrolled and seeded from `skill`, so a different skill must
                  give them a FRESH instance rather than an Effect that re-syncs. */}
              {tab === "config" && <ConfigTab key={skill.id} skill={skill} />}
              {tab === "preview" && <PreviewTab skill={skill} />}
              {/* No `key`: ContextTab holds no copy of server state, rendering
                  straight from the query cache. */}
              {tab === "context" && <ContextTab skillId={skill.id} />}
              {tab === "evals" && <EvalsTab />}
              {tab === "stats" && <StatsTab skill={skill} />}
              {tab === "versions" && <VersionsTab skill={skill} />}
            </div>
          </>
        )}
      </div>
    </SkillsListView>
  );
}

function Header({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.header}>
      <Icon.Sparkles size={17} style={s.headerIcon} />
      <h1 className="mono" style={s.title}>
        {skill.name}
      </h1>
      <Badge color={typeColor(skill.type)} mono>
        {t(`listItem.type.${skill.type}`)}
      </Badge>
      <Badge color="var(--text-muted)" icon="GitCommit" mono>
        {t("editor.versionLabel", { version: skill.version })}
      </Badge>
      {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
      {needsVetting(skill) && (
        <Badge color="var(--warn)" icon="AlertTriangle">
          {t("listItem.needsVetting")}
        </Badge>
      )}
      <div style={s.headerActions}>
        {/* Disabled: skill evals arrive with the eval_* tables in a later lesson. */}
        <Button kind="secondary" size="sm" icon="Play" disabled title={t("evals.runDisabled")}>
          {t("evals.run")}
        </Button>
      </div>
    </div>
  );
}
