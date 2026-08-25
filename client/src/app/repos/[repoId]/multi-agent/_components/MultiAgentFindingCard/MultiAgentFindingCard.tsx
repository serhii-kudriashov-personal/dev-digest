/* MultiAgentFindingCard — one finding inside an agent's lane (SPEC-05).
   Same shape as the shipped `FindingCard` (severity, category, file:line,
   confidence, rationale/suggestion, accept/dismiss/learn/add-to-evals), plus
   an explicit agent attribution line — model-authored text shown on this
   screen must be visibly attributable to its source (spec §Untrusted
   inputs), not only inferable from which lane it sits in.

   Accept/Dismiss/"Add to eval cases" copy is READ from `prReview.json` (not
   edited — that file is `impl-client-entry`'s), the same words the shipped
   `FindingCard` uses, so a finding reads identically wherever it is judged. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/eval";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { s } from "./styles";

export function MultiAgentFindingCard({
  finding,
  agentName,
  prId,
  multiAgentRunId,
  repoId,
  prNumber,
}: {
  finding: FindingRecord;
  /** The recorded agent name for this lane (AC-23) — shown even if the agent
   *  is later deleted. */
  agentName: string;
  /** The underlying PR's id, for `useFindingAction`'s own invalidation. */
  prId: string;
  /** So a judgement made here also refreshes this multi-agent run's cached
   *  result (`["multi-agent-run", multiAgentRunId]`) — `useFindingAction` and
   *  `useCreateEvalCaseFromFinding` only know about the PR-page's query keys
   *  (AC-40: "reflect it everywhere that finding is shown"). */
  multiAgentRunId: string;
  repoId: string;
  prNumber?: number | null;
}) {
  const t = useTranslations("runs");
  const tFinding = useTranslations("prReview");
  const qc = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();
  const [evalCaseCreated, setEvalCaseCreated] = React.useState<{
    caseId: string;
    agentId: string;
  } | null>(null);

  const sevColor = SEV_COLOR[finding.severity] ?? SEV_COLOR_FALLBACK;
  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  const learned = !!finding.learned_at;
  const muted = accepted || dismissed;

  const invalidateRunResult = () =>
    qc.invalidateQueries({ queryKey: ["multi-agent-run", multiAgentRunId] });

  const gotoHref =
    prNumber != null
      ? `/repos/${repoId}/pulls/${prNumber}?tab=diff&goto=${encodeURIComponent(
          `${finding.file}:${finding.start_line}`,
        )}`
      : null;
  const fileLineStyle: React.CSSProperties = { fontSize: 13, color: "var(--text-secondary)" };

  return (
    <div data-finding-id={finding.id} style={s.card(sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={finding.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{finding.title}</span>
            <CategoryTag category={finding.category as Category} />
            {accepted && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)" }}>{tFinding("finding.accepted")}</span>}
            {dismissed && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                {tFinding("finding.dismissed")}
              </span>
            )}
          </div>
          <div style={s.metaRow}>
            {gotoHref ? (
              <Link href={gotoHref} className="mono" style={fileLineStyle} onClick={(e) => e.stopPropagation()}>
                {finding.file}:{lineLabel(finding)}
              </Link>
            ) : (
              <span className="mono" style={fileLineStyle}>
                {finding.file}:{lineLabel(finding)}
              </span>
            )}
            <ConfidenceNum value={finding.confidence} />
          </div>
          <div style={s.attribution}>{agentName}</div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{finding.rationale}</Markdown>
          </div>
          {finding.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("trace.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{finding.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={action.isPending}
              active={accepted}
              onClick={() =>
                action.mutate(
                  { findingId: finding.id, action: "accept", prId },
                  { onSuccess: invalidateRunResult },
                )
              }
            >
              {tFinding("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={action.isPending}
              active={dismissed}
              onClick={() =>
                action.mutate(
                  { findingId: finding.id, action: "dismiss", prId },
                  { onSuccess: invalidateRunResult },
                )
              }
            >
              {tFinding("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Brain"
              disabled={action.isPending || learned}
              active={learned}
              onClick={() =>
                action.mutate(
                  { findingId: finding.id, action: "learn", prId },
                  { onSuccess: invalidateRunResult },
                )
              }
            >
              {learned ? t("action.learnRecorded") : t("action.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!muted || createEvalCase.isPending}
              title={!muted ? tFinding("finding.addToEvalsDisabledReason") : undefined}
              aria-label={tFinding("finding.addToEvals")}
              onClick={() =>
                createEvalCase.mutate(finding.id, {
                  onSuccess: (result) => {
                    setEvalCaseCreated({ caseId: result.case.id, agentId: result.case.owner_id });
                    invalidateRunResult();
                  },
                })
              }
            >
              {tFinding("finding.addToEvals")}
            </Button>
          </div>

          {evalCaseCreated && (
            <div style={s.evalCaseBanner}>
              <Icon.FlaskConical size={14} />
              <span>{t("action.evalCaseCreated")}</span>
              <Link href={`/agents/${evalCaseCreated.agentId}?tab=evals&case=${evalCaseCreated.caseId}`}>
                {tFinding("finding.viewEvalCase")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
