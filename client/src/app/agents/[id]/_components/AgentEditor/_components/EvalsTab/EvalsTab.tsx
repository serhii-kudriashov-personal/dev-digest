/* EvalsTab — L06, SPEC-04: an agent's eval case set, run history, compare and
   promote. Case creation/edit opens `CaseEditorModal` at `?case=<id>` (A8);
   the whole tab renders from the query cache, no local copy of server state
   (same discipline as `SkillsTab`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Checkbox, EmptyState, Icon, Modal, Skeleton } from "@devdigest/ui";
import { EvalMetricBar, EVAL_METRIC_COLORS } from "@/components/eval-metric-bar";
import { useAgent } from "@/lib/hooks/agents";
import {
  useCancelEvalRun,
  useEvalCases,
  useEvalComparison,
  useEvalRun,
  useEvalRuns,
  useEvalTrend,
  useDeleteEvalCase,
  usePromoteAgentVersion,
  useRunEvalCase,
  useRunEvalSet,
} from "@/lib/hooks/eval";
import { CaseEditorModal } from "./CaseEditorModal";
import { NEW_CASE_PARAM } from "./constants";
import { canCompare, formatCost, formatPct } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const dash = t("evalsTab.unknown");

  const { data: agent } = useAgent(agentId);
  const { data: cases, isLoading: casesLoading } = useEvalCases(agentId);
  const { data: runs } = useEvalRuns(agentId);
  const { data: trend } = useEvalTrend(agentId);
  const runSet = useRunEvalSet(agentId);
  const cancelRun = useCancelEvalRun(agentId);
  const runCase = useRunEvalCase(agentId);
  const deleteCase = useDeleteEvalCase(agentId);
  const promote = usePromoteAgentVersion();

  const latestRow = runs?.[0];
  const isRunning = latestRow?.status === "running";
  const { data: liveRun } = useEvalRun(isRunning ? latestRow.id : undefined);
  const current = isRunning ? (liveRun ?? latestRow) : latestRow;
  const previousMetricsRun = runs?.[1];

  // ---- case editor modal (?case=) ------------------------------------------
  const caseParam = search.get("case");
  const navigate = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(search.toString());
    mutate(sp);
    router.replace(`${pathname}?${sp.toString()}`);
  };
  const openCase = (id: string) => navigate((sp) => sp.set("case", id));
  const closeCase = () => navigate((sp) => sp.delete("case"));

  // ---- compare selection ----------------------------------------------------
  const [selected, setSelected] = React.useState<string[]>([]);
  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [comparing, setComparing] = React.useState(false);
  const compareBtnWrapRef = React.useRef<HTMLSpanElement | null>(null);
  const closeCompare = () => {
    setComparing(false);
    compareBtnWrapRef.current?.querySelector("button")?.focus(); // AC-48
  };
  const [a, b] = comparing && selected.length === 2 ? selected : [undefined, undefined];
  const { data: comparison } = useEvalComparison(a, b);

  // ---- run-all confirmation (NFR-4, AC-31): state the case count and the
  // previous comparable run's cost, or that none is known, before spending. */
  const [confirmingRun, setConfirmingRun] = React.useState(false);
  const previousRun = runs?.find((r) => r.status !== "running");
  const previousCost = previousRun?.cost_usd ?? null;
  const runSetConfirmMessage =
    previousCost === null
      ? t("evalsTab.runSetConfirmCostUnknown", { count: cases?.length ?? 0 })
      : t("evalsTab.runSetConfirmCostKnown", {
          count: cases?.length ?? 0,
          cost: formatCost(previousCost, dash),
        });
  const confirmRun = () => {
    setConfirmingRun(false);
    runSet.mutate(undefined);
  };

  return (
    <div style={s.wrap}>
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <div>
            <div style={s.sectionTitle}>{t("evalsTab.metricsTitle")}</div>
            <div style={s.sectionSubtitle}>{t("evalsTab.metricsSubtitle")}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={!cases || cases.length === 0 || isRunning}
              loading={runSet.isPending}
              onClick={() => setConfirmingRun(true)}
            >
              {t("evalsTab.runSet", { count: cases?.length ?? 0 })}
            </Button>
            {isRunning && current && (
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                loading={cancelRun.isPending}
                onClick={() => cancelRun.mutate(current.id)}
              >
                {t("evalsTab.stop")}
              </Button>
            )}
          </div>
        </div>

        {isRunning && current && (
          <div style={s.progressRow} aria-live="polite">
            <span>{t("evalsTab.progress", { done: current.cases_done, total: current.cases_covered })}</span>
          </div>
        )}

        {!current ? (
          <div style={s.sectionSubtitle}>{t("evalsTab.neverRunAgent")}</div>
        ) : (
          <div style={s.metricRow}>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>{t("dashboard.metrics.recall")}</div>
              <div style={s.metricValueRecall}>{formatPct(current.recall, dash)}</div>
              <MetricDelta curr={current.recall} prev={previousMetricsRun?.recall ?? null} />
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>{t("dashboard.metrics.precision")}</div>
              <div style={s.metricValuePrecision}>{formatPct(current.precision, dash)}</div>
              <MetricDelta curr={current.precision} prev={previousMetricsRun?.precision ?? null} />
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>{t("dashboard.metrics.citationAccuracy")}</div>
              <div style={s.metricValueCitation}>{formatPct(current.citation_accuracy, dash)}</div>
              <MetricDelta
                curr={current.citation_accuracy}
                prev={previousMetricsRun?.citation_accuracy ?? null}
              />
            </div>
            <div style={s.metricCard}>
              <div style={s.metricLabel}>{t("dashboard.metrics.tracesPassed")}</div>
              <div style={s.metricValue}>
                {current.cases_passed}/{current.cases_covered}
              </div>
            </div>
          </div>
        )}
      </div>

      {trend && trend.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
          <TrendSeries
            label={t("dashboard.legend.recall")}
            color="var(--accent)"
            values={trend.map((p) => p.recall)}
            dash={dash}
          />
          <TrendSeries
            label={t("dashboard.legend.precision")}
            color="var(--warn)"
            values={trend.map((p) => p.precision)}
            dash={dash}
          />
          <TrendSeries
            label={t("dashboard.legend.citation")}
            color="var(--crit)"
            values={trend.map((p) => p.citation_accuracy)}
            dash={dash}
          />
        </div>
      )}

      <div style={s.section}>
        <div style={s.sectionHeader}>
          <div style={s.sectionTitle}>{t("evalsTab.casesHeading")}</div>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => openCase(NEW_CASE_PARAM)}>
            {t("evalsTab.newCase")}
          </Button>
        </div>

        {casesLoading ? (
          <Skeleton height={120} />
        ) : !cases || cases.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
        ) : (
          cases.map((c) => (
            <div key={c.id} style={s.caseRow}>
              <div style={s.caseMain}>
                <div style={s.caseName}>{c.name}</div>
                <div style={s.caseMeta}>
                  {c.needs_repair
                    ? t("caseEditor.needsRepair")
                    : c.expectation?.kind === "must_find"
                      ? t("caseEditor.expectation.mustFind")
                      : t("caseEditor.expectation.mustNotFlag")}
                  {" · "}
                  {c.last_result === "never_run"
                    ? t("evalsTab.neverRun")
                    : c.last_result === "pass"
                      ? t("evalsTab.passed")
                      : t("evalsTab.failed")}
                </div>
              </div>
              <div style={s.caseActions}>
                <Button kind="ghost" size="sm" icon="Play" onClick={() => runCase.mutate(c.id)}>
                  {t("evalsTab.run")}
                </Button>
                <Button kind="ghost" size="sm" icon="Edit" onClick={() => openCase(c.id)}>
                  {t("evalsTab.edit")}
                </Button>
                <Button kind="ghost" size="sm" icon="Trash" onClick={() => deleteCase.mutate(c.id)}>
                  {t("evalsTab.delete")}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={s.section}>
        <div style={s.sectionHeader}>
          <div style={s.sectionTitle}>{t("evalsTab.historyHeading")}</div>
          {/* The wrapping span (not a `ref` on Button, which isn't forwarded)
              is what AC-48's focus-return targets after the compare panel closes. */}
          <span ref={compareBtnWrapRef}>
            <Button
              kind="secondary"
              size="sm"
              icon="GitBranch"
              disabled={!canCompare(selected)}
              title={
                selected.length === 2
                  ? undefined
                  : selected.length === 0
                    ? t("evalsTab.compareNeedsTwo")
                    : t("evalsTab.compareTooMany", { count: selected.length })
              }
              onClick={() => setComparing(true)}
            >
              {t("evalsTab.compare")}
            </Button>
          </span>
        </div>

        {!runs || runs.length === 0 ? (
          <EmptyState icon="History" title={t("dashboard.noRuns")} />
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}></th>
                <th style={s.th}>{t("evalsTab.historyColumns.ranAt")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.version")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.recall")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.precision")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.citation")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.passed")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.cost")}</th>
                <th style={s.th}>{t("evalsTab.historyColumns.status")}</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={s.td}>
                    <Checkbox checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
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
                  </td>
                  <td style={s.td}>{formatCost(r.cost_usd, dash)}</td>
                  <td style={s.td}>
                    {r.status === "incomplete" ? (
                      <span style={s.incompleteBadge} title={t("evalsTab.incompleteTooltip")}>
                        {t("evalsTab.incomplete")}
                      </span>
                    ) : (
                      r.status
                    )}
                  </td>
                  <td style={s.td}>
                    {agent && r.config_version !== agent.version && (
                      <Button
                        kind="ghost"
                        size="sm"
                        onClick={() => promote.mutate({ agentId, version: r.config_version })}
                      >
                        {t("evalsTab.promote")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {comparing && comparison && (
          <ComparePanel comparison={comparison} onClose={closeCompare} dash={dash} />
        )}
      </div>

      {confirmingRun && (
        <Modal
          title={t("evalsTab.runSet", { count: cases?.length ?? 0 })}
          onClose={() => setConfirmingRun(false)}
          footer={
            <div style={s.confirmFooter}>
              <Button kind="ghost" size="sm" onClick={() => setConfirmingRun(false)}>
                {t("evalsTab.cancelRunCta")}
              </Button>
              <Button kind="primary" size="sm" loading={runSet.isPending} onClick={confirmRun}>
                {t("evalsTab.confirmRunCta")}
              </Button>
            </div>
          }
        >
          <div style={s.confirmBody}>{runSetConfirmMessage}</div>
        </Modal>
      )}

      {caseParam && <CaseEditorModal agentId={agentId} caseId={caseParam} onClose={closeCase} />}
    </div>
  );
}

/** The delta chip on a metric card, in whole percentage points against the
 *  previous run — `null` when either side is unknown (never rendered, not a
 *  false "0pt"). */
function MetricDelta({ curr, prev }: { curr: number | null; prev: number | null }) {
  const t = useTranslations("eval");
  if (curr === null || prev === null) return null;
  const diff = Math.round(curr * 100) - Math.round(prev * 100);
  if (diff === 0) {
    return (
      <span style={{ ...s.metricDelta, ...s.directionFlat }}>
        <Icon.Dot size={12} />
        {t("evalsTab.deltaPoints", { delta: 0 })}
      </span>
    );
  }
  return (
    <span style={{ ...s.metricDelta, ...(diff > 0 ? s.directionUp : s.directionDown) }}>
      {diff > 0 ? <Icon.TrendingUp size={12} /> : <Icon.TrendingDown size={12} />}
      {t("evalsTab.deltaPoints", { delta: Math.abs(diff) })}
    </span>
  );
}

/** AC-47: one metric's history as a plain SVG sparkline — every series
 *  carries its own text label, so a series is identifiable without relying
 *  on colour (no charting library needed for something this small). */
function TrendSeries({
  label,
  color,
  values,
  dash,
}: {
  label: string;
  color: string;
  values: (number | null)[];
  dash: string;
}) {
  const known = values
    .map((v, i) => ({ x: i, y: v }))
    .filter((p): p is { x: number; y: number } => p.y !== null);
  const denom = values.length > 1 ? values.length - 1 : 1;
  const points = known.map((p) => `${(p.x / denom) * 100},${100 - p.y * 100}`).join(' ');

  return (
    <div style={s.trendRow}>
      <span style={s.trendLabel}>
        <span style={{ ...s.trendSwatch, background: color }} />
        {label}
      </span>
      {known.length >= 2 ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={s.sparkline}>
          <polyline points={points} fill="none" stroke={color} strokeWidth={3} />
        </svg>
      ) : (
        <span style={s.sectionSubtitle}>{dash}</span>
      )}
    </div>
  );
}

function ComparePanel({
  comparison,
  onClose,
  dash,
}: {
  comparison: NonNullable<ReturnType<typeof useEvalComparison>["data"]>;
  onClose: () => void;
  dash: string;
}) {
  const t = useTranslations("eval");
  const earlierLines = (comparison.prompts.earlier ?? "").split("\n");
  const laterLines = (comparison.prompts.later ?? "").split("\n");
  const earlierSet = new Set(earlierLines);
  const laterSet = new Set(laterLines);

  return (
    <div style={s.comparePanel}>
      <div style={s.sectionHeader}>
        <div style={s.sectionTitle}>{t("compare.title")}</div>
        <Button kind="ghost" size="sm" icon="X" onClick={onClose}>
          {t("evalsTab.closeCompare")}
        </Button>
      </div>

      {!comparison.attributability.attributable && (
        <div style={s.warningBanner}>
          <Icon.AlertTriangle size={14} />
          {comparison.attributability.case_set_changed && t("evalsTab.caseSetChanged")}
          {comparison.attributability.model_changed && t("evalsTab.modelChanged")}
          {" "}
          {t("evalsTab.notAttributable")}
        </div>
      )}

      {comparison.detail_expired && <div style={s.warningBanner}>{t("compare.detailExpired")}</div>}

      <div style={s.compareMetrics}>
        {comparison.metrics.map((m) => (
          <div key={m.key} style={s.metricCard}>
            <div style={s.metricLabel}>{m.key}</div>
            <div style={s.metricValue}>
              {formatPct(m.earlier, dash)} → {formatPct(m.later, dash)}
            </div>
            <div
              style={
                m.delta === null || m.delta === 0
                  ? s.directionFlat
                  : m.delta > 0
                    ? s.directionUp
                    : s.directionDown
              }
            >
              {m.delta === null ? (
                dash
              ) : m.delta > 0 ? (
                <Icon.TrendingUp size={14} />
              ) : m.delta < 0 ? (
                <Icon.TrendingDown size={14} />
              ) : (
                <Icon.Dot size={14} />
              )}
              {t("compare.delta")} {m.delta === null ? dash : `${(m.delta * 100).toFixed(0)}%`}
            </div>
          </div>
        ))}
      </div>

      <div style={s.comparePrompts}>
        <div>
          <div style={s.sectionSubtitle}>{t("compare.promptBefore")}</div>
          <div style={s.promptBox}>
            {earlierLines.map((line, i) => (
              <div key={i} style={laterSet.has(line) ? undefined : s.promptLineChanged}>
                {line || " "}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={s.sectionSubtitle}>{t("compare.promptAfter")}</div>
          <div style={s.promptBox}>
            {laterLines.map((line, i) => (
              <div key={i} style={earlierSet.has(line) ? undefined : s.promptLineChanged}>
                {line || " "}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
