/* StatsTab — is this skill earning its tokens?

   Two kinds of number here, and the tab is explicit about which is which.
   USED BY / RUNS / PULL are deterministic: the server wrote `agent_skills` and
   `run_skills` itself. ACCEPT RATE and the category breakdown depend on
   `findings.skill_id`, which starts as a model-reported slug that the server
   validated against the skills actually injected into that run — so the
   unattributed count sits next to them as the honest denominator. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { formatRate } from "@/lib/format";
import { useSkillStats } from "@/lib/hooks/skills";
import { CategoryDonut } from "./CategoryDonut";
import { CATEGORY_COLORS } from "./constants";
import { s } from "./styles";

function Tile({
  label,
  value,
  unit,
  ring,
}: {
  label: string;
  value: string | number;
  unit?: string;
  ring?: number | null;
}) {
  return (
    <div style={s.tile}>
      <div style={s.tileText}>
        <div style={s.tileLabel}>{label}</div>
        <div style={s.tileValue}>
          <span className="tnum">{value}</span>
          {unit && <span style={s.tileUnit}>{unit}</span>}
        </div>
      </div>
      {/* Only draw the ring when there is a rate to draw. */}
      {ring != null && <CircularScore score={Math.round(ring * 100)} size={44} />}
    </div>
  );
}

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: stats, isLoading } = useSkillStats(skill.id);

  if (isLoading || !stats) return <Skeleton height={220} />;

  const categories = Object.entries(stats.findings_by_category)
    .map(([label, value]) => ({
      label,
      value,
      color: CATEGORY_COLORS[label] ?? "var(--text-muted)",
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <Tile
          label={t("stats.usedBy")}
          value={stats.used_by_count}
          unit={t("stats.agentsUnit", { count: stats.used_by_count })}
        />
        <Tile label={t("stats.runs")} value={stats.runs_count} unit={t("stats.runsUnit")} />
        <Tile label={t("stats.pullFrequency")} value={formatRate(stats.pull_rate)} />
        <Tile
          label={t("stats.acceptRate")}
          value={formatRate(stats.accept_rate)}
          ring={stats.accept_rate}
        />
        <Tile label={t("stats.findings30d")} value={stats.findings_last_30d} />
      </div>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Cpu size={12} />
            {t("stats.agentsUsing")}
          </div>
          {stats.agents.length === 0 && <p style={s.empty}>{t("stats.noAgents")}</p>}
          {stats.agents.map((a) => (
            <div key={a.id} style={s.agentRow}>
              <Icon.Cpu size={13} />
              <span style={s.agentName}>{a.name}</span>
              <button
                type="button"
                onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-text)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: 0,
                }}
              >
                {t("stats.open")}
              </button>
            </div>
          ))}
        </div>

        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Tag size={12} />
            {t("stats.findingsByCategory")}
          </div>
          {categories.length === 0 ? (
            <p style={s.empty}>{t("stats.noFindings")}</p>
          ) : (
            <CategoryDonut segments={categories} />
          )}
        </div>
      </div>

      {/* Always shown, including at zero: without it the numbers above imply a
          completeness they do not have. */}
      <p style={s.caveat}>
        {t("stats.attributionCaveat", { count: stats.unattributed_count })}
      </p>
    </div>
  );
}
