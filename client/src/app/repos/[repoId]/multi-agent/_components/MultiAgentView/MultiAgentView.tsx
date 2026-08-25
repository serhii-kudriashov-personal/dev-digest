/* MultiAgentView — /repos/:repoId/multi-agent (SPEC-05). Owns every search
   param on this screen (`pr`, `run`, `mode`, `trace`, `agent` — Q4) through a
   single `setParams` that rebuilds the whole `URLSearchParams` and issues one
   `router.replace`, the same pattern `PrDetailView.tsx` uses for the same
   reason: two sequential single-param writes would each start from the same
   snapshot and the second would drop the first (`client/INSIGHTS.md`
   2026-08-10).

   Three states, driven entirely by those params:
   - no `run` yet for the chosen `pr` (or no `pr` at all) → `ConfigureRunPanel`
     (AC-8, AC-9, AC-44), with the pull already pre-selected once `?pr=` is in
     the address (AC-6's handoff from the PR-header picker).
   - a `run` exists → `MultiAgentResults` in the address's `mode` (AC-38).
   - `?trace=` is set → the SAME shipped `RunTraceDrawer`, mounted whole
     (AC-48…AC-53). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Tabs, type TabDef } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { usePulls, useAgentHistory, useMultiAgentRuns, useMultiAgentRun } from "@/lib/hooks";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { MultiAgentResults } from "../MultiAgentResults";
import { ConfigureRunPanel } from "../ConfigureRunPanel";
import {
  AGENT_PARAM,
  DEFAULT_MODE,
  MODE_PARAM,
  NEW_PARAM,
  PR_PARAM,
  RUN_PARAM,
  TRACE_PARAM,
  VIEW_MODES,
  type ViewMode,
} from "../../constants";
import { estimate, lastPrStorageKey } from "./helpers";
import { s } from "./styles";

export function MultiAgentView() {
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("runs");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const prId = search.get(PR_PARAM);
  const runId = search.get(RUN_PARAM);
  const modeParam = search.get(MODE_PARAM) ?? "";
  const mode: ViewMode = (VIEW_MODES as readonly string[]).includes(modeParam)
    ? (modeParam as ViewMode)
    : DEFAULT_MODE;
  const traceRunId = search.get(TRACE_PARAM);
  const selectedAgentRunId = search.get(AGENT_PARAM);
  const forceNew = search.get(NEW_PARAM) === "1";

  const setParams = (entries: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(entries)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/multi-agent${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const { data: pulls } = usePulls(repoId);
  const { data: history } = useAgentHistory();
  const { data: runs } = useMultiAgentRuns(prId);
  const hasRuns = (runs?.length ?? 0) > 0;
  // `forceNew` (the "Start new review" button) is the only way back to
  // Configure once a PR has a run — without it, `runs?.[0]` always wins and
  // Configure becomes unreachable for that PR (US-6 vs the button this view
  // is missing otherwise).
  const activeRunId = forceNew ? null : runId ?? runs?.[0]?.id ?? null;
  const { data: result, isLoading: resultLoading } = useMultiAgentRun(activeRunId);

  // Reopening this screen with no `?pr=` (the left-nav entry point has none)
  // restores the last PR this browser looked at here, so "go to Multi-Agent
  // Review" comes back to the last run instead of an empty Configure screen
  // every time (US-6). Runs once per mount; an explicit PR pick or a shared
  // link always wins over the stored value.
  React.useEffect(() => {
    if (prId) return;
    try {
      const lastPr = localStorage.getItem(lastPrStorageKey(repoId));
      if (lastPr) setParams({ [PR_PARAM]: lastPr });
    } catch {
      // localStorage unavailable (private mode, disabled) — fall back to
      // the ordinary PR-less Configure screen.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!prId) return;
    try {
      localStorage.setItem(lastPrStorageKey(repoId), prId);
    } catch {
      // Same fallback as above — nothing to remember next time.
    }
  }, [repoId, prId]);

  // The agent selection for a run that hasn't started yet. Ephemeral UI state
  // rather than a query param — unlike `run`/`mode`/`trace`/`agent`, nothing
  // here needs to survive a shared link or a reload before the run exists
  // (`client/INSIGHTS.md` 2026-08-10).
  const [selected, setSelected] = React.useState<string[]>([]);
  const toggleSelected = (agentId: string) =>
    setSelected((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  const selectAll = () => setSelected((history ?? []).map((h) => h.agent_id));
  const est = estimate(selected, history ?? []);

  // Live status comes from `useMultiAgentRun`'s own poll (AC-29): it refetches
  // on an interval for as long as `result.lanes` has a `queued`/`running`
  // entry and stops on its own once every lane has settled — no SSE
  // subscription here, this screen only reads `result`.

  const traceLane = traceRunId ? (result?.lanes ?? []).find((l) => l.run_id === traceRunId) ?? null : null;

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const modeTabs: TabDef[] = [
    { key: "columns", label: t("page.view.columns") },
    { key: "tabs", label: t("page.view.tabs") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>{t("page.title")}</h1>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
        </div>

        {!activeRunId ? (
          <>
            {prId && !hasRuns && <div style={s.noRunBanner}>{t("state.noRun")}</div>}
            {prId && forceNew && hasRuns && (
              <div style={s.noRunBanner}>
                {t("page.startNewNote")}{" "}
                <button
                  type="button"
                  style={s.backLink}
                  onClick={() => setParams({ [NEW_PARAM]: null })}
                >
                  {t("page.backToResults")}
                </button>
              </div>
            )}
            <ConfigureRunPanel
              pulls={pulls ?? []}
              prId={prId}
              onSelectPr={(id) => setParams({ [PR_PARAM]: id })}
              history={history ?? []}
              selected={selected}
              onToggle={toggleSelected}
              onSelectAll={selectAll}
              estimateDurationMs={est.durationMs}
              estimateCostUsd={est.costUsd}
              onStarted={(newRunId) => {
                setSelected([]);
                setParams({ [RUN_PARAM]: newRunId, [MODE_PARAM]: DEFAULT_MODE, [NEW_PARAM]: null });
              }}
            />
          </>
        ) : (
          <>
            <div style={s.toolbar}>
              <Button
                kind="secondary"
                size="sm"
                icon="Plus"
                onClick={() => setParams({ [NEW_PARAM]: "1", [RUN_PARAM]: null })}
              >
                {t("page.startNew")}
              </Button>
              <span style={s.spacer} />
              <Tabs tabs={modeTabs} value={mode} onChange={(m) => setParams({ [MODE_PARAM]: m })} pad="0" />
            </div>
            <MultiAgentResults
              result={result}
              loading={resultLoading}
              mode={mode}
              selectedRunId={selectedAgentRunId}
              onSelectAgent={(id) => setParams({ [AGENT_PARAM]: id })}
              onOpenTrace={(id) => setParams({ [TRACE_PARAM]: id })}
            />
          </>
        )}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={traceLane?.agent_name ?? null}
          prNumber={result?.pr_number ?? null}
          findings={traceLane?.findings ?? []}
          running={traceLane?.status === "running"}
          onClose={() => setParams({ [TRACE_PARAM]: null })}
        />
      )}
    </AppShell>
  );
}
