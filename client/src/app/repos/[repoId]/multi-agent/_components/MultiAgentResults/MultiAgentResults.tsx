/* MultiAgentResults — the results section of a multi-agent run (SPEC-05).
   Takes the resolved `MultiAgentRunResult` plus a `loading` flag as PROPS,
   never a run id: the shell (`MultiAgentView`, hop `impl-client-entry`) is
   the one caller that fetches (`useMultiAgentRun`), so this component stays
   usable by any future non-fetching caller too (`frontend-ui-architecture`
   §4, `client/INSIGHTS.md` 2026-08-02).

   `DisagreementPanel` is rendered in exactly ONE place in this tree,
   regardless of `mode` — that is what keeps its filter state identical
   across a Columns↔Tabs switch (AC-28): the element never unmounts, so its
   internal `onlyConflicts` state survives the toggle.

   `confidence` is never read here — it only ever reaches the DOM inside
   `MultiAgentFindingCard`, as an attribute (AC-37). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton, Tabs, type TabDef } from "@devdigest/ui";
import type { MultiAgentRunResult } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { AgentLane } from "../AgentLane";
import { DisagreementPanel } from "../DisagreementPanel";
import { allLanesFailed, formatDurationSeconds, noFindingsAtAll } from "./helpers";
import { s } from "./styles";

export type MultiAgentResultMode = "columns" | "tabs";

export interface MultiAgentResultsProps {
  result: MultiAgentRunResult | undefined;
  loading: boolean;
  mode: MultiAgentResultMode;
  /**
   * Tabs-mode only: the active lane's `run_id`. The shell tracks this via
   * `?agent=` so that closing a trace restores the same tab (AC-52). Ignored
   * in Columns mode. Defaults to the first lane when unset.
   */
  selectedRunId?: string | null;
  onSelectAgent?: (runId: string) => void;
  onOpenTrace: (runId: string) => void;
}

export function MultiAgentResults({
  result,
  loading,
  mode,
  selectedRunId,
  onSelectAgent,
  onOpenTrace,
}: MultiAgentResultsProps) {
  const t = useTranslations("runs");

  if (loading) {
    return (
      <div style={s.skeletonWrap}>
        <Skeleton height={20} width={280} />
        <Skeleton height={140} />
        <Skeleton height={140} />
      </div>
    );
  }
  if (!result) return null;

  const { lanes, locations, locations_total, completed_lane_count } = result;
  const failedAll = allLanesFailed(lanes);
  const emptyAll = !failedAll && noFindingsAtAll(lanes);
  const activeRunId = selectedRunId ?? lanes[0]?.run_id ?? null;
  const activeLane = lanes.find((l) => l.run_id === activeRunId) ?? lanes[0];

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.meta}>
          {t("page.meta", {
            count: lanes.length,
            duration: formatDurationSeconds(result.total_duration_ms),
            cost: formatCost(result.total_cost_usd),
          })}
        </span>
        <span style={s.spacer} />
        {result.stale && (
          <span style={s.banner("var(--warn)", "var(--warn-bg)")}>
            <Icon.AlertTriangle size={14} />
            {t("state.stale")}
          </span>
        )}
      </div>

      {failedAll && (
        <div style={s.banner("var(--crit)", "var(--crit-bg)")}>
          <Icon.XCircle size={14} />
          {t("state.allFailed")}
        </div>
      )}
      {emptyAll && (
        <div style={s.banner("var(--text-secondary)", "var(--bg-elevated)")}>
          <Icon.Info size={14} />
          {t("state.noFindings")}
        </div>
      )}

      {mode === "columns" ? (
        <div style={s.grid}>
          {lanes.map((lane) => (
            <AgentLane
              key={lane.run_id}
              lane={lane}
              prId={result.pr_id}
              repoId={result.repo_id}
              prNumber={result.pr_number}
              multiAgentRunId={result.id}
              onOpenTrace={onOpenTrace}
            />
          ))}
        </div>
      ) : (
        <div>
          <Tabs
            tabs={lanes.map(
              (l): TabDef => ({ key: l.run_id, label: l.agent_name, count: l.findings_total }),
            )}
            value={activeRunId ?? ""}
            onChange={(key) => onSelectAgent?.(key)}
          />
          {activeLane && (
            <div style={{ marginTop: 14 }}>
              <AgentLane
                lane={activeLane}
                prId={result.pr_id}
                repoId={result.repo_id}
                prNumber={result.pr_number}
                multiAgentRunId={result.id}
                onOpenTrace={onOpenTrace}
              />
            </div>
          )}
        </div>
      )}

      <DisagreementPanel
        locations={locations}
        locationsTotal={locations_total}
        completedLaneCount={completed_lane_count}
        repoId={result.repo_id}
        prNumber={result.pr_number}
      />
    </div>
  );
}
