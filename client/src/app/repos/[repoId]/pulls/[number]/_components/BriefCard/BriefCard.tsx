"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, SectionLabel } from "@devdigest/ui";
import type { BriefGenerationResult, PrRiskBriefRecord } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { s } from "./styles";
import { RISK_COLOR } from "./constants";

/**
 * The PR Risk Brief (SPEC-02): a why + risk summary and up to five
 * "read this first" entries that jump into the reviewer-ordered diff.
 *
 * Takes RESOLVED DATA plus flags, never a `prId` it fetches from — same
 * contract as `IntentCard`/`BlastRadiusCard`. `brief` is the last STORED
 * document (from the query cache); `result` is the last `generate()` OUTCOME
 * (from the mutation), which is how a `too_large` / `failed` / `not_configured`
 * answer reaches the card even though none of those states persists anything.
 */
interface BriefCardProps {
  brief: PrRiskBriefRecord | null | undefined;
  loading: boolean;
  generating: boolean;
  result: BriefGenerationResult | null | undefined;
  onGenerate: () => void;
  onOpenFocus: (path: string, line: number) => void;
}

export function BriefCard({
  brief,
  loading,
  generating,
  result,
  onGenerate,
  onOpenFocus,
}: BriefCardProps) {
  const t = useTranslations("brief");
  const tBlast = useTranslations("blast");

  if (loading) return null;

  // While a generation is in flight, a leftover `result` from a PREVIOUS
  // attempt must not flash its banner — the generating state wins (AC-27).
  const outcome = !generating ? result : null;

  if (!brief) {
    if (generating) {
      return (
        <BriefSection>
          <EmptyState icon="Shield" title={t("riskBrief.generating")} />
        </BriefSection>
      );
    }
    if (outcome?.state === "not_configured") {
      return (
        <BriefSection>
          <EmptyState
            icon="Settings"
            title={t("riskBrief.notConfigured.title")}
            body={t("riskBrief.notConfigured.body")}
          />
        </BriefSection>
      );
    }
    if (outcome?.state === "too_large") {
      return (
        <BriefSection>
          <EmptyState
            icon="Shield"
            title={t("riskBrief.tooLarge.title")}
            body={t("riskBrief.tooLarge.body")}
          />
        </BriefSection>
      );
    }
    if (outcome?.state === "failed") {
      return (
        <BriefSection>
          <EmptyState
            icon="Shield"
            title={t("riskBrief.failed.title")}
            body={t("riskBrief.failed.body")}
            cta={t("riskBrief.retry")}
            onCta={onGenerate}
          />
        </BriefSection>
      );
    }
    return (
      <BriefSection>
        <EmptyState
          icon="Shield"
          title={t("riskBrief.empty.title")}
          body={t("riskBrief.empty.body")}
          cta={t("riskBrief.generate")}
          onCta={onGenerate}
        />
      </BriefSection>
    );
  }

  const risk = RISK_COLOR[brief.risk_level];
  // `pr_identity` is never dropped (AC-14) and never in `missing_inputs` in
  // practice — filtered defensively so a future contract change cannot
  // surface a "PR identity is missing" claim that can never be true.
  const missing = brief.missing_inputs.filter((label) => label !== "pr_identity");
  const costText =
    brief.cost_usd == null ? t("riskBrief.costUnknown") : formatCost(brief.cost_usd);

  return (
    <BriefSection>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <Badge color={risk.c} bg={risk.bg} icon={risk.icon}>
            {`${t("riskBrief.riskLevel")}: ${t(`riskBrief.risk.${brief.risk_level}`)}`}
          </Badge>
          {brief.stale && (
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("stale")}
            </Badge>
          )}
          {!brief.index_complete && brief.index_reason && (
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {tBlast(`reason.${brief.index_reason}`)}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          kind="tertiary"
          icon="RefreshCw"
          onClick={onGenerate}
          loading={generating}
          disabled={generating}
        >
          {generating ? t("riskBrief.generating") : t("riskBrief.regenerate")}
        </Button>
      </div>

      {brief.stale && <div style={s.note}>{t("riskBrief.staleHint")}</div>}

      <div style={s.whyBlock}>
        <div>
          <div style={s.sectionTitle}>{t("riskBrief.whatTitle")}</div>
          <div style={s.why}>{brief.what}</div>
        </div>
        <div>
          <div style={s.sectionTitle}>{t("riskBrief.whyTitle")}</div>
          <div style={s.why}>{brief.why}</div>
        </div>
      </div>

      <div style={s.sectionTitle}>{t("riskBrief.focusTitle")}</div>
      {brief.review_focus.length === 0 ? (
        <div style={s.note}>{t("riskBrief.noFocus")}</div>
      ) : (
        <div style={s.focusList}>
          {brief.review_focus.map((entry, i) => (
            <button
              key={`${entry.path}:${entry.line}:${i}`}
              type="button"
              style={s.focusRow}
              aria-label={t("riskBrief.openFocus", { path: entry.path, line: entry.line })}
              onClick={() => onOpenFocus(entry.path, entry.line)}
            >
              <span style={s.focusPath} title={entry.path}>
                {entry.path}:{entry.line}
              </span>
              <span style={s.focusReason} title={entry.reason}>
                {entry.reason}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={s.sectionTitle}>{t("block.risks")}</div>
      {brief.risks.length === 0 ? (
        <div style={s.note}>{t("noRisks")}</div>
      ) : (
        <div style={s.risks}>
          {brief.risks.map((r, i) => {
            const c = RISK_COLOR[r.severity];
            return (
              <div key={i} style={s.risk}>
                <div style={s.riskHeader}>
                  <Badge color={c.c} bg={c.bg} icon={c.icon}>
                    {t(`riskBrief.risk.${r.severity}`)}
                  </Badge>
                  <span style={s.riskTitle}>{r.title}</span>
                </div>
                <div style={s.riskExplanation}>{r.explanation}</div>
              </div>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div style={s.meta}>
          <span>{t("riskBrief.missingLabel")}:</span>
          {missing.map((label) => (
            <Badge key={label}>{t(`riskBrief.inputs.${label}`)}</Badge>
          ))}
        </div>
      )}

      <div style={s.meta}>
        <Badge icon="Sparkles">{t("riskBrief.generatedLabel")}</Badge>
        <span>
          {t("riskBrief.costLabel")}: {costText}
        </span>
      </div>
    </BriefSection>
  );
}

function BriefSection({ children }: { children: React.ReactNode }) {
  const t = useTranslations("brief");
  return (
    <section>
      <SectionLabel icon="Shield">{t("block.risks")}</SectionLabel>
      <div style={s.card}>{children}</div>
    </section>
  );
}
