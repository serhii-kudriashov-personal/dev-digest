"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, SectionLabel } from "@devdigest/ui";
import type { BriefGenerationResult, PrRiskBriefRecord } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { s } from "./styles";
import { RISK_COLOR } from "../../constants";

/**
 * The PR Risk Brief's header row: status, risk level, the risks list, and the
 * input accounting (included/missing/dropped). The `what`/`why` text, the
 * regenerate control, and the review-focus list live elsewhere —
 * `PrBriefSection` (the Overview tab's top section, which pairs `what`+`why`
 * with the latest review's verdict/score once one exists, and owns
 * regenerate since it's the surface that shows the generated text) and
 * `ReviewFocusSection`.
 *
 * Still owns the FIRST-generation ladder (empty / generating / failed /
 * not_configured / too_large): `PrBriefSection` renders nothing at all until
 * a brief exists, so those states — and their own CTA to generate or retry —
 * have nowhere else to live.
 *
 * Takes RESOLVED DATA plus flags, never a `prId` it fetches from — same
 * contract as `IntentCard`/`BlastRadiusCard`. `brief` is the last STORED
 * document (from the query cache); `result` is the last `generate()` OUTCOME
 * (from the mutation), which is how a `too_large` / `failed` / `not_configured`
 * answer reaches the bar even though none of those states persists anything.
 */
interface BriefBarProps {
  brief: PrRiskBriefRecord | null | undefined;
  loading: boolean;
  generating: boolean;
  result: BriefGenerationResult | null | undefined;
  onGenerate: () => void;
  /**
   * Opens a risk's `file_refs` entry in the Diff tab — same callback
   * `BlastRadiusCard`'s caller rows use. A risk carries no line number, so
   * every ref opens at line 1: enough to land on the right file's card, and
   * harmless when no rendered diff line matches (`useDiffLineTarget.goTo`
   * just opens the card without a scroll in that case).
   */
  onOpenCaller: (path: string, line: number) => void;
}

export function BriefBar({
  brief,
  loading,
  generating,
  result,
  onGenerate,
  onOpenCaller,
}: BriefBarProps) {
  const t = useTranslations("brief");
  const tBlast = useTranslations("blast");

  if (loading) return null;

  // While a generation is in flight, a leftover `result` from a PREVIOUS
  // attempt must not flash its banner — the generating state wins (AC-27).
  const outcome = !generating ? result : null;

  if (!brief) {
    if (generating) {
      return (
        <BriefBarSection>
          <EmptyState icon="Shield" title={t("riskBrief.generating")} />
        </BriefBarSection>
      );
    }
    if (outcome?.state === "not_configured") {
      return (
        <BriefBarSection>
          <EmptyState
            icon="Settings"
            title={t("riskBrief.notConfigured.title")}
            body={t("riskBrief.notConfigured.body")}
          />
        </BriefBarSection>
      );
    }
    if (outcome?.state === "too_large") {
      return (
        <BriefBarSection>
          <EmptyState
            icon="Shield"
            title={t("riskBrief.tooLarge.title")}
            body={t("riskBrief.tooLarge.body")}
          />
        </BriefBarSection>
      );
    }
    if (outcome?.state === "failed") {
      return (
        <BriefBarSection>
          <EmptyState
            icon="Shield"
            title={t("riskBrief.failed.title")}
            body={t("riskBrief.failed.body")}
            cta={t("riskBrief.retry")}
            onCta={onGenerate}
          />
        </BriefBarSection>
      );
    }
    return (
      <BriefBarSection>
        <EmptyState
          icon="Shield"
          title={t("riskBrief.empty.title")}
          body={t("riskBrief.empty.body")}
          cta={t("riskBrief.generate")}
          onCta={onGenerate}
        />
      </BriefBarSection>
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
    <BriefBarSection>
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
      </div>

      {brief.stale && <div style={s.note}>{t("riskBrief.staleHint")}</div>}

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
                {r.file_refs.length > 0 && (
                  <div style={s.riskRefs}>
                    {r.file_refs.map((path) => (
                      <button
                        key={path}
                        type="button"
                        style={s.riskRefButton}
                        aria-label={t("riskBrief.openFile", { path })}
                        onClick={() => onOpenCaller(path, 1)}
                      >
                        {path}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {brief.included_inputs.length > 0 && (
        <div style={s.meta}>
          <span>{t("riskBrief.includedLabel")}:</span>
          {brief.included_inputs.map((label) => (
            <Badge key={label}>{t(`riskBrief.inputs.${label}`)}</Badge>
          ))}
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

      {brief.dropped_refs > 0 && (
        <div style={s.meta}>
          <span>{t("riskBrief.droppedLabel", { count: brief.dropped_refs })}</span>
        </div>
      )}

      <div style={s.meta}>
        <Badge icon="Sparkles">{t("riskBrief.generatedLabel")}</Badge>
        <span>
          {t("riskBrief.costLabel")}: {costText}
        </span>
      </div>
    </BriefBarSection>
  );
}

function BriefBarSection({ children }: { children: React.ReactNode }) {
  const t = useTranslations("brief");
  return (
    <section>
      <SectionLabel icon="Shield">{t("riskBrief.barTitle")}</SectionLabel>
      <div style={s.card}>{children}</div>
    </section>
  );
}
