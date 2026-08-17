"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { PrRiskBriefRecord, ReviewRecord, Verdict } from "@devdigest/shared";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

/**
 * The top of the Overview tab: the Risk Brief's `what` + `why` as one plain
 * description of the PR, plus — once at least one agent has run — the
 * newest review's verdict, findings/blockers, agent name and score wrapped
 * around that same text via `VerdictBanner` (the same component the Agent
 * Runs tab renders per expanded run). `what`/`why` moved up here from
 * `BriefBar`, which no longer renders them.
 *
 * The text is available the moment a brief is generated — independent of
 * whether any review has ever run (`docs/pr-risk-brief.md` §The six inputs:
 * `findings` is merely one best-effort input, never required). The
 * verdict/score/findings/agent row is additive: it appears only once a
 * review with a verdict exists, never replacing the text.
 *
 * Owns the regenerate control too, in the `SectionLabel`'s `right` slot (the
 * same header-level-action pattern `FindingsTab`'s "Live review" section
 * already uses) — one location regardless of whether a review has run, since
 * it is THIS surface's text that gets regenerated. `BriefBar` still owns the
 * FIRST-generation ladder (empty / generating / failed / …), because this
 * component renders nothing at all until a brief exists.
 *
 * Takes RESOLVED DATA plus callbacks, never fetches: `brief` and `review`
 * are both already held by `OverviewTab`/`PrDetailView` for their own
 * surfaces, and `costUsd`/`tokensIn` come from the matching `agent_runs` row,
 * joined by `run_id` the same way `FindingsTab` already joins cost onto a
 * review — cost and tokens live on the RUN, not the review. Both that and
 * `onOpenRun` (the "View run details" control, beside the agent-name badge)
 * are rendered by `VerdictBanner` itself — this component only passes them
 * through.
 */
interface PrBriefSectionProps {
  brief: PrRiskBriefRecord | null | undefined;
  briefLoading: boolean;
  generating: boolean;
  onGenerate: () => void;
  review: ReviewRecord | null;
  costUsd: number | null;
  tokensIn: number | null;
  onOpenRun: () => void;
}

export function PrBriefSection({
  brief,
  briefLoading,
  generating,
  onGenerate,
  review,
  costUsd,
  tokensIn,
  onOpenRun,
}: PrBriefSectionProps) {
  const t = useTranslations("prReview");
  const tBrief = useTranslations("brief");

  if (briefLoading || !brief) return null;

  const text = `${brief.what} ${brief.why}`;

  const regenerateButton = (
    <Button
      size="sm"
      kind="tertiary"
      icon="RefreshCw"
      onClick={onGenerate}
      loading={generating}
      disabled={generating}
    >
      {generating ? tBrief("riskBrief.generating") : tBrief("riskBrief.regenerate")}
    </Button>
  );

  // A review with no verdict (e.g. a bare summary row) reads the same as no
  // review at all — `VerdictBanner` requires a non-null `Verdict`, the same
  // guard `ReviewRunAccordion` uses before rendering it.
  const hasReview = !!review && !!review.verdict;

  if (!hasReview) {
    return (
      <section>
        <SectionLabel icon="FileText" right={regenerateButton}>
          {t("brief.title")}
        </SectionLabel>
        <div style={s.textCard}>{text}</div>
      </section>
    );
  }

  const blockers = review.findings.filter(
    (f) => f.severity === "CRITICAL" && !f.dismissed_at,
  ).length;

  return (
    <section>
      <SectionLabel icon="FileText" right={regenerateButton}>
        {t("brief.title")}
      </SectionLabel>
      <VerdictBanner
        verdict={review.verdict as Verdict}
        summary={text}
        score={review.score}
        findingsCount={review.findings.length}
        blockers={blockers}
        agentName={review.agent_name}
        costUsd={costUsd}
        tokensIn={tokensIn}
        onOpenRun={onOpenRun}
      />
    </section>
  );
}
