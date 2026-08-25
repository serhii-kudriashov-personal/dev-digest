/* ConfigureRunPanel — the Configure-run screen's body (SPEC-05). A PR chooser
   over the caller's `pulls` list, plus the agent block ("AgentPicker" — the
   SAME control the PR header uses, born shared) and the per-agent history
   that backs the pre-run estimate.

   The agent block is visibly INERT until a pull request is chosen (AC-8): no
   pointer events, and a note explaining why. `selected`, the estimate and the
   history rows are all supplied by `MultiAgentView` as plain data — this
   component fetches nothing (`frontend-ui-architecture` §4). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { AgentHistoryRow, PrMeta } from "@devdigest/shared";
import { AgentPicker, type AgentPickerAgent } from "@/components/agent-picker";
import { useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { formatCost } from "@/lib/format";
import { s } from "./styles";

/** Seconds-formatted duration, or an em dash for "not yet known" — never `0`
 *  (root `INSIGHTS.md` 2026-08-02). */
function formatSeconds(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface ConfigureRunPanelProps {
  pulls: PrMeta[];
  prId: string | null;
  onSelectPr: (prId: string) => void;
  history: AgentHistoryRow[];
  selected: string[];
  onToggle: (agentId: string) => void;
  onSelectAll: () => void;
  /** Pre-computed by `MultiAgentView` (`estimate()` in its `helpers.ts`) so
   *  this component stays presentational. */
  estimateDurationMs: number | null;
  estimateCostUsd: number | null;
  onStarted: (runId: string) => void;
}

export function ConfigureRunPanel({
  pulls,
  prId,
  onSelectPr,
  history,
  selected,
  onToggle,
  onSelectAll,
  estimateDurationMs,
  estimateCostUsd,
  onStarted,
}: ConfigureRunPanelProps) {
  const t = useTranslations("runs");
  const start = useStartMultiAgentRun();

  const agents: AgentPickerAgent[] = React.useMemo(
    () => history.map((h) => ({ id: h.agent_id, name: h.agent_name, enabled: h.enabled })),
    [history],
  );

  const prOptions = React.useMemo(
    () =>
      pulls
        .filter((p): p is PrMeta & { id: string } => p.id != null)
        .map((p) => ({ value: p.id, label: t("page.prItem", { number: p.number, title: p.title }) })),
    [pulls, t],
  );

  const handleConfirm = () => {
    if (!prId || selected.length === 0) return;
    start.mutate(
      { prId, agentIds: selected },
      { onSuccess: (data) => onStarted(data.id) },
    );
  };

  return (
    <div style={s.root}>
      <div style={s.prField}>
        <label style={s.label}>{t("page.selectPr")}</label>
        <SelectInput
          value={prId ?? ""}
          onChange={(v) => v && onSelectPr(v)}
          options={[{ value: "", label: t("page.selectPr") }, ...prOptions]}
        />
      </div>

      <div style={s.agentBlock}>
        <div style={prId ? undefined : s.inert}>
          {!prId && <div style={s.inertNote}>{t("page.noRun.bodySelect")}</div>}
          <AgentPicker
            agents={agents}
            selected={selected}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
            onConfirm={handleConfirm}
            pending={start.isPending}
          />
        </div>

        {selected.length > 0 && (
          <div style={s.estimate}>
            {t("estimate.approx")}:{" "}
            {estimateDurationMs != null
              ? t("estimate.duration", { seconds: Math.round(estimateDurationMs / 1000) })
              : t("estimate.unknown")}
            {" · "}
            {estimateCostUsd != null
              ? t("estimate.cost", { cost: formatCost(estimateCostUsd) })
              : t("estimate.unknown")}
          </div>
        )}

        {history.length > 0 && (
          <ul style={s.historyList}>
            {history.map((row) => (
              <li key={row.agent_id} style={s.historyRow}>
                <span style={s.historyAgent}>{row.agent_name}</span>
                {row.last_run ? (
                  <>
                    <span style={s.historyMeta}>
                      {t("history.lastRun")}: {formatSeconds(row.last_run.duration_ms)} ·{" "}
                      {formatCost(row.last_run.cost_usd)} ·{" "}
                      {t("history.attributed", {
                        number: row.last_run.pr_number ?? 0,
                        date: new Date(row.last_run.ran_at).toLocaleDateString(),
                      })}
                    </span>
                    {row.last_run.summary && (
                      <span style={s.historySummary}>{truncate(row.last_run.summary, 80)}</span>
                    )}
                  </>
                ) : (
                  <span style={s.historyMeta}>{t("history.noRuns")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
