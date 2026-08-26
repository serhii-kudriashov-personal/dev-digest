/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { formatCost, formatTokenCount } from "@/lib/format";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  costUsd,
  tokensIn,
  onOpenRun,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  /**
   * Cost/tokens of the run behind this verdict, shown under the score gauge.
   * Optional and OMITTED (not just null) by callers that already show cost
   * elsewhere — `ReviewRunAccordion` renders it in its own header row, so it
   * never passes these and this block stays absent there.
   */
  costUsd?: number | null;
  tokensIn?: number | null;
  /**
   * "View run details" — rendered beside the agent-name badge. Optional and
   * OMITTED by `ReviewRunAccordion`: that card IS the run's own details,
   * already expanded, so there is nowhere else to navigate to.
   */
  onOpenRun?: () => void;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
          {onOpenRun && (
            <Button kind="tertiary" size="sm" icon="ArrowRight" onClick={onOpenRun}>
              {t("brief.viewRun")}
            </Button>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
      </div>
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
          {costUsd !== undefined && (
            <div style={s.scoreMeta}>
              <span>{formatCost(costUsd)}</span>
              {formatTokenCount(tokensIn) && <span>{formatTokenCount(tokensIn)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
