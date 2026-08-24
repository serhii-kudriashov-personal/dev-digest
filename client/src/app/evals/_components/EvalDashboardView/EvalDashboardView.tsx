/* EvalDashboardView — L06, SPEC-04: the cross-agent Eval Dashboard (`/evals`).
   Renders exactly what `GET /eval-dashboard` recorded (NFR-9) — no score is
   ever recomputed client-side. The interactive leaf under a thin page.tsx
   (frontend-ui-architecture §9). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { EvalMetricBar, EVAL_METRIC_COLORS } from "@/components/eval-metric-bar";
import { useEvalDashboard, useRunAllEvals } from "@/lib/hooks/eval";
import { formatCost, formatPct } from "@/lib/eval-format";
import { ApiError } from "@/lib/api";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const dash = t("dashboard.unknown");
  const { data, isLoading, isError, error, refetch } = useEvalDashboard();
  const runAll = useRunAllEvals();

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("dashboard.defaultTitle") }];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("dashboard.defaultTitle")}
          body={error instanceof ApiError ? error.message : t("dashboard.engineError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.wrap}>
          <Skeleton height={24} width={240} />
          <Skeleton height={160} />
        </div>
      </AppShell>
    );
  }

  const noAgents = data.agents.length === 0;

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div style={s.header}>
          <div style={s.title}>{t("dashboard.defaultTitle")}</div>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={noAgents}
            loading={runAll.isPending}
            onClick={() => runAll.mutate()}
          >
            {runAll.isPending ? t("dashboard.runningAll") : t("dashboard.runAll")}
          </Button>
        </div>

        {data.alert && (
          <div style={s.alert} data-testid="derived-note">
            <Icon.Info size={14} /> {data.alert}
          </div>
        )}

        {noAgents ? (
          <EmptyState icon="FlaskConical" title={t("dashboard.noAgentsTitle")} body={t("dashboard.noAgentsBody")} />
        ) : (
          <div style={s.section}>
            <div style={s.sectionTitle}>{t("dashboard.agentsHeading")}</div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.agentColumns.agent")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.cases")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.lastRun")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.recall")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.precision")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.citation")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.passed")}</th>
                  <th style={s.th}>{t("dashboard.agentColumns.direction")}</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <AgentRow key={a.agent_id} agent={a} dash={dash} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={s.section}>
          <div style={s.sectionTitle}>{t("dashboard.recentRunsHeading")}</div>
          {data.recent_runs.length === 0 ? (
            <EmptyState icon="History" title={t("dashboard.noRuns")} />
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.agent")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.ranAt")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.version")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.recall")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.precision")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.citation")}</th>
                  <th style={s.th}>{t("dashboard.recentRunsColumns.passed")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.map((r) => (
                  <tr key={r.id}>
                    <td style={s.td}>{r.agent_name ?? dash}</td>
                    <td style={s.td}>{new Date(r.ran_at).toLocaleString()}</td>
                    <td style={s.td}>v{r.config_version}</td>
                    <td style={s.td}>
                      <EvalMetricBar value={r.recall} color={EVAL_METRIC_COLORS.recall} dash={dash} />
                    </td>
                    <td style={s.td}>
                      <EvalMetricBar value={r.precision} color={EVAL_METRIC_COLORS.precision} dash={dash} />
                    </td>
                    <td style={s.td}>
                      <EvalMetricBar
                        value={r.citation_accuracy}
                        color={EVAL_METRIC_COLORS.citation}
                        dash={dash}
                      />
                    </td>
                    <td style={s.td}>
                      {r.cases_passed}/{r.cases_covered}
                      {r.cost_usd !== null ? ` · ${formatCost(r.cost_usd, dash)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** One row of the Agents table — clicking it opens that agent's Evals tab,
 *  the same run history and case set this dashboard is summarizing. */
function AgentRow({ agent: a, dash }: { agent: EvalAgentSummary; dash: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const [hovered, setHovered] = React.useState(false);

  return (
    <tr
      style={hovered ? s.trHover : s.trClickable}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => router.push(`/agents/${a.agent_id}?tab=evals`)}
    >
      <td style={s.td}>{a.agent_name}</td>
      <td style={s.td}>{a.cases_total}</td>
      <td style={s.td}>
        {a.never_run ? (
          <span style={s.neverRunBadge}>{t("dashboard.neverRun")}</span>
        ) : (
          a.last_run && new Date(a.last_run.ran_at).toLocaleDateString()
        )}
      </td>
      <td style={{ ...s.td, ...(a.never_run ? undefined : s.metricRecall) }}>
        {a.never_run ? dash : formatPct(a.last_run?.recall ?? null, dash)}
      </td>
      <td style={{ ...s.td, ...(a.never_run ? undefined : s.metricPrecision) }}>
        {a.never_run ? dash : formatPct(a.last_run?.precision ?? null, dash)}
      </td>
      <td style={{ ...s.td, ...(a.never_run ? undefined : s.metricCitation) }}>
        {a.never_run ? dash : formatPct(a.last_run?.citation_accuracy ?? null, dash)}
      </td>
      <td style={s.td}>
        {a.never_run ? dash : `${a.last_run?.cases_passed ?? 0}/${a.last_run?.cases_covered ?? 0}`}
      </td>
      <td style={s.td}>
        {a.direction === null ? (
          dash
        ) : (
          <span
            style={
              a.direction === "up"
                ? s.direction.up
                : a.direction === "down"
                  ? s.direction.down
                  : s.direction.flat
            }
          >
            {a.direction === "up" ? (
              <Icon.TrendingUp size={14} />
            ) : a.direction === "down" ? (
              <Icon.TrendingDown size={14} />
            ) : (
              <Icon.Dot size={14} />
            )}
            {t(`dashboard.direction.${a.direction}`)}
          </span>
        )}
      </td>
    </tr>
  );
}
