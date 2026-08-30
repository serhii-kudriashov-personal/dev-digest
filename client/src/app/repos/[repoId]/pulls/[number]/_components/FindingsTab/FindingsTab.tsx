"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit, Severity } from "@devdigest/shared";
import type { ForgeRepoRef } from "@/lib/forge-urls";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /**
   * Cancelling is the caller's business — this tab only needs to ask for it and
   * to know whether a request is in flight. Taking the whole `UseMutationResult`
   * would tie the component to TanStack Query for two members it actually uses.
   */
  onCancelRuns: (runIds: string[]) => void;
  cancelling: boolean;
  /** The owning repository + head sha — deep-links a finding's file:line on its own forge (AC-29). */
  repo?: ForgeRepoRef | null;
  headSha?: string | null;
  /** Page-wide severity selection (`?severity=`); counts stay per-run. */
  severities: Severity[];
  onToggleSeverity: (sev: Severity) => void;
  /**
   * A finding to jump to, from `?finding=<id>` — a severity chip in the diff
   * opens the page in a new browser tab pointed at it. Handed to every
   * accordion; only the run that produced it reacts.
   */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  onCancelRuns,
  cancelling,
  repo,
  headSha,
  severities,
  onToggleSeverity,
  targetFindingId = null,
  targetFindingNonce = 0,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const handleCancelAll = useCallback(() => {
    onCancelRuns(liveRunIds);
  }, [liveRunIds, onCancelRuns]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Cost lives on the RUN (agent_runs), not on the review — but the accordion
  // renders from ReviewRecord. Both are already on this page, joined by run_id,
  // so we index here instead of widening ReviewRecord or adding a server join.
  const costByRun = React.useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of prRuns ?? []) m.set(r.run_id, r.cost_usd);
    return m;
  }, [prRuns]);

  // The mirror image, for the Timeline's severity badges: `RunSummary` carries
  // only `findings_count`, so the breakdown comes from the reviews already on
  // this page, indexed the same way. A run with no review record (its review
  // was deleted) is simply absent — the timeline falls back to its own count.
  const findingsByRun = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const rev of runs) if (rev.run_id) m.set(rev.run_id, rev.findings);
    return m;
  }, [runs]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelling}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            costUsd={review.run_id ? costByRun.get(review.run_id) ?? null : null}
            repo={repo}
            headSha={headSha}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
            targetFindingId={targetFindingId}
            targetFindingNonce={targetFindingNonce}
            severities={severities}
            onToggleSeverity={onToggleSeverity}
          />
        ))
      )}
    </section>
  );
}
