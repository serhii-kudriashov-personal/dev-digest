"use client";

import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { PrRiskBriefRecord } from "@devdigest/shared";
import { s } from "./styles";

/**
 * The brief's "read this first" entries (SPEC-02), standalone (SPEC-03): up
 * to five review-focus rows that jump into the reviewer-ordered diff.
 *
 * Takes RESOLVED DATA plus flags, never a `prId` it fetches from — same
 * contract as `BriefBar`/`IntentCard`/`BlastRadiusCard`. Owns no state ladder
 * of its own: every failure and empty-brief state is `BriefBar`'s (SPEC-03
 * AC-50) — a never-briefed PR shows nothing here at all.
 */
interface ReviewFocusSectionProps {
  brief: PrRiskBriefRecord | null | undefined;
  loading: boolean;
  onOpenFocus: (path: string, line: number) => void;
}

export function ReviewFocusSection({ brief, loading, onOpenFocus }: ReviewFocusSectionProps) {
  const t = useTranslations("brief");

  if (loading || !brief) return null;

  return (
    <section>
      <SectionLabel icon="ListChecks">{t("riskBrief.focusTitle")}</SectionLabel>
      <div style={s.card}>
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
      </div>
    </section>
  );
}
