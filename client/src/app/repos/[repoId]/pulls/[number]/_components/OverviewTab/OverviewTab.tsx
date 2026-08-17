"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrFile, ReviewRecord } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { useBlastRadius } from "@/lib/hooks/blast";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { BriefBar } from "../BriefBar";
import { PrBriefSection } from "../PrBriefSection";
import { ReviewFocusSection } from "../ReviewFocusSection";
import { s } from "./styles";

interface OverviewTabProps {
  /** Null while the PR list is still resolving `number` → id; the hooks no-op. */
  prId: string | null | undefined;
  /** The PR's CURRENT head sha — what a stored intent is judged stale against. */
  headSha: string | null | undefined;
  prBody: string | null | undefined;
  /** "owner/repo", null until the repo is loaded — for github.com deep-links. */
  repoFullName: string | null;
  /** The PR's changed files: which blast callers can be opened in the Diff tab. */
  files: PrFile[];
  /**
   * The PR's newest review run (across all agents), already fetched by
   * `PrDetailView` for the Agent Runs tab — this tab reads it, never fetches
   * its own copy. Null before any review has run.
   */
  latestReview: ReviewRecord | null;
  /** Cost/tokens of the `agent_runs` row behind `latestReview`, joined by
   *  `run_id` upstream — cost and tokens live on the run, not the review. */
  latestReviewCostUsd: number | null;
  latestReviewTokensIn: number | null;
  /** Switches to the Agent Runs tab, where that run's accordion opens by default. */
  onOpenLatestRun: () => void;
  /** Opens the Diff tab at `path:line`; owned by `PrDetailView`, which owns the URL. */
  onOpenCaller: (path: string, line: number) => void;
}

export function OverviewTab({
  prId,
  headSha,
  prBody,
  repoFullName,
  files,
  latestReview,
  latestReviewCostUsd,
  latestReviewTokensIn,
  onOpenLatestRun,
  onOpenCaller,
}: OverviewTabProps) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);
  const { data: blast, isLoading: blastLoading } = useBlastRadius(prId);
  const { data: brief, isLoading: briefLoading } = usePrBrief(prId);
  const generateBrief = useGenerateBrief(prId);

  // Derived during render, never stored and never synced by an Effect: it is a
  // pure function of two values already in hand. The server also reports its
  // own `stale`, but recomputing here keeps the badge correct the moment the
  // PR's head sha changes in the cache.
  const stale = !!intent?.head_sha && !!headSha && intent.head_sha !== headSha;

  // Same belt-and-braces recompute for the brief: the server's own `stale`
  // reflects the LAST time this document was fetched, and two panels of one
  // screen reading two query keys go stale asymmetrically otherwise
  // (`client/INSIGHTS.md` 2026-08-09). Folded into the record rather than a
  // separate prop, so each of the three surfaces below still takes exactly one
  // `brief` — this recompute is the SCREEN's job, not any one surface's
  // (`client/INSIGHTS.md` 2026-08-17).
  const briefStale =
    !!brief && (brief.stale || (!!brief.head_sha && !!headSha && brief.head_sha !== headSha));
  const briefWithStale = brief ? { ...brief, stale: briefStale } : brief;

  const changedPaths = React.useMemo(() => new Set(files.map((f) => f.path)), [files]);

  return (
    <>
      <PrBriefSection
        brief={briefWithStale ?? null}
        briefLoading={briefLoading}
        generating={generateBrief.isPending}
        onGenerate={() => generateBrief.mutate({ force: true })}
        review={latestReview}
        costUsd={latestReviewCostUsd}
        tokensIn={latestReviewTokensIn}
        onOpenRun={onOpenLatestRun}
      />

      <BriefBar
        brief={briefWithStale ?? null}
        loading={briefLoading}
        generating={generateBrief.isPending}
        result={generateBrief.data}
        onGenerate={() => generateBrief.mutate({ force: true })}
        onOpenCaller={onOpenCaller}
      />

      <ReviewFocusSection
        brief={briefWithStale ?? null}
        loading={briefLoading}
        onOpenFocus={onOpenCaller}
      />

      <div style={s.summaryRow}>
        <IntentCard
          intent={intent ?? null}
          loading={isLoading}
          stale={stale}
          deriving={derive.isPending}
          onDerive={() => derive.mutate({ force: true })}
        />

        <BlastRadiusCard
          blast={blast}
          loading={blastLoading}
          changedPaths={changedPaths}
          repoFullName={repoFullName}
          headSha={headSha ?? null}
          onOpenCaller={onOpenCaller}
        />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
