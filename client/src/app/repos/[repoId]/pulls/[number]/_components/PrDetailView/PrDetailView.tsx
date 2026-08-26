/* PR Detail screen — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton, ErrorState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePullDetail, usePulls } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
} from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import { PrDetailHeader } from "../PrDetailHeader";
import { OverviewTab } from "../OverviewTab";
import { FindingsTab } from "../FindingsTab";
import { DiffTab } from "../DiffTab";
import RunTraceDrawer from "../RunTraceDrawer";
import {
  SEVERITY_PARAM,
  parseSeverityParam,
  serializeSeverityParam,
  toggleSeverity,
} from "../SeverityFilterBar";
import { DEFAULT_TAB, FINDING_PARAM } from "./constants";
import { s } from "./styles";

export function PrDetailView() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun(prId);
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? DEFAULT_TAB;
  const traceRunId = search.get("trace");
  /**
   * Update several search params in ONE navigation. Two sequential `setParam`
   * calls would each rebuild from the same `search` snapshot, so the second
   * `router.replace` drops the first update — and the Blast Radius handoff sets
   * `tab` and `goto` together.
   */
  const setParams = (entries: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(entries)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  const setTab = (t: string) => setParam("tab", t);

  /**
   * `?goto=<path>:<line>` — the Blast Radius card's cross-tab handoff.
   *
   * THIS component owns every search param on the screen and is the only one that
   * clears `goto`: it does so when `DiffTab` reports the target handed off, which
   * is also what makes a second click on the same caller row work (the param has
   * to be absent for the next identical value to register as a change).
   */
  const goto = search.get("goto");

  // Severity filter: ONE selection for the whole page (each run's accordion
  // still shows its own counts). Living in the query makes it survive reload
  // and travel in a shared link, like ?tab and ?trace.
  const severities = React.useMemo(
    () => parseSeverityParam(search.get(SEVERITY_PARAM)),
    [search],
  );
  const onToggleSeverity = (sev: Severity) =>
    setParam(SEVERITY_PARAM, serializeSeverityParam(toggleSeverity(severities, sev)));

  // Files changed → Findings: clicking a severity chip on a diff line opens that
  // finding's card in a NEW BROWSER TAB, so the reader keeps their place in the
  // diff. The target therefore has to live in the URL (`?finding=`) rather than
  // in state — the new tab is a cold load and shares no React tree with this one.
  // No `?severity=` is carried over: a fresh tab has no selection, so there is
  // nothing that could filter the card out.
  const targetFindingId = search.get(FINDING_PARAM);
  const goToFinding = (finding: FindingRecord) => {
    const url = `/repos/${repoId}/pulls/${number}?tab=findings&${FINDING_PARAM}=${encodeURIComponent(finding.id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  // The Overview tab's PR Brief section reads the newest run only — cost and
  // tokens live on the `agent_runs` row, not the review, so they are joined by
  // `run_id` here the same way `FindingsTab` already joins cost onto a review.
  const latestReview = runs[0] ?? null;
  const latestRun =
    latestReview?.run_id != null
      ? (prRuns ?? []).find((r) => r.run_id === latestReview.run_id) ?? null
      : null;
  // Memo on `reviews`, not on `runs`: `runs` is a fresh array every render, so
  // depending on it would defeat the memo — and listing `reviews` while reading
  // `runs` is the same thing written in a way the linter cannot verify.
  const allFindings: FindingRecord[] = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loadingStack}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={s.tabBody}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            headSha={pr.head_sha}
            prBody={pr.body}
            repoFullName={repoFullName}
            files={pr.files}
            latestReview={latestReview}
            latestReviewCostUsd={latestRun?.cost_usd ?? null}
            latestReviewTokensIn={latestRun?.tokens_in ?? null}
            onOpenLatestRun={() => setTab("findings")}
            // One `router.replace`, not two: `tab` and `goto` have to land in the
            // same navigation or the second call would rebuild from the same
            // `search` snapshot and drop the first.
            onOpenCaller={(path, line) =>
              setParams({ tab: "diff", goto: `${path}:${line}` })
            }
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            severities={severities}
            onToggleSeverity={onToggleSeverity}
            targetFindingId={targetFindingId}
            targetFindingNonce={1}
            onCancelRuns={(ids) => ids.forEach((id) => cancel.mutate(id))}
            cancelling={cancel.isPending}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            onGoToFinding={goToFinding}
            goto={goto}
            onGotoConsumed={() => setParam("goto", null)}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
