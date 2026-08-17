/* AgentEditor — basic agent config editor (model + system prompt). Later
   lessons add Skills/Evals/Stats/CI tabs; the Part-0 starter ships Config only.
   Tab state still lives in ?tab= for forward-compatibility. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* `key` is load-bearing: ConfigTab is an uncontrolled form seeded from
            `agent`, so switching agents must give it a FRESH instance rather
            than leave it re-syncing nine fields in an Effect. */}
        {tab === "skills" ? (
          // SkillsTab needs no `key`: it holds no copy of server state, rendering
          // straight from the query cache (its mutation updates that cache
          // optimistically), so switching agents cannot leave it stale.
          <SkillsTab agentId={agent.id} />
        ) : tab === "context" ? (
          // Same reason as SkillsTab: no local copy of the ordered list, so no
          // `key` is needed to force a fresh instance.
          <ContextTab agentId={agent.id} />
        ) : (
          <ConfigTab key={agent.id} agent={agent} />
        )}
      </div>
    </div>
  );
}
