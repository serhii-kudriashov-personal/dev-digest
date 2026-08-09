"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, SectionLabel } from "@devdigest/ui";
import type { PrIntentRecord } from "@devdigest/shared";
import { s } from "./styles";
import { CONFIDENCE_COLOR } from "./constants";

/**
 * The derived PR intent, shown back to the author so a wrong reading is visible
 * BEFORE it distorts a review rather than after.
 *
 * Takes RESOLVED DATA plus flags, never a `prId` it fetches from — the owner of
 * the query is the tab that already holds the PR. The confidence shown is the
 * server's DETERMINISTIC tier (computed from which sources were actually
 * available); the model's own self-rating is deliberately not rendered.
 */
interface IntentCardProps {
  intent: PrIntentRecord | null | undefined;
  loading: boolean;
  stale: boolean;
  deriving: boolean;
  onDerive: () => void;
}

export function IntentCard({ intent, loading, stale, deriving, onDerive }: IntentCardProps) {
  const t = useTranslations("brief");

  if (loading) return null;

  if (!intent) {
    return (
      <section>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div style={s.card}>
          <EmptyState
            icon="Target"
            title={t("unavailable")}
            body={t("unavailableHint")}
            cta={deriving ? t("deriving") : t("derive")}
            onCta={onDerive}
            ctaLoading={deriving}
          />
        </div>
      </section>
    );
  }

  const confidence = intent.confidence ?? null;
  const sources = intent.sources ?? [];

  return (
    <section>
      <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            {confidence && (
              <Badge color={CONFIDENCE_COLOR[confidence].c} bg={CONFIDENCE_COLOR[confidence].bg}>
                {`${t("confidenceLabel")}: ${t(`confidence.${confidence}`)}`}
              </Badge>
            )}
            {stale && (
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("stale")}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            kind="tertiary"
            icon="RefreshCw"
            onClick={onDerive}
            loading={deriving}
            disabled={deriving}
          >
            {deriving ? t("deriving") : t("rederive")}
          </Button>
        </div>

        <div style={s.intent}>{intent.intent}</div>

        {stale && <div style={s.meta}>{t("staleHint")}</div>}

        {(intent.in_scope.length > 0 || intent.out_of_scope.length > 0) && (
          <div style={s.lists}>
            {intent.in_scope.length > 0 && (
              <div style={s.listCol}>
                <div style={s.listTitle}>{t("inScope")}</div>
                <ul style={s.list}>
                  {intent.in_scope.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {intent.out_of_scope.length > 0 && (
              <div style={s.listCol}>
                <div style={s.listTitle}>{t("outOfScope")}</div>
                <ul style={s.list}>
                  {intent.out_of_scope.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {sources.length > 0 && (
          <div style={s.meta}>
            <span>{t("sourcesLabel")}:</span>
            {/* Badge, not Chip: Chip renders a <button>, and these labels are
                not interactive — it would also pollute every button query. */}
            {sources.map((source) => (
              <Badge key={source}>{t(`sources.${source}`)}</Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
