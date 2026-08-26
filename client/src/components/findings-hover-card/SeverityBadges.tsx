/* SeverityBadges — a findings breakdown as one compact badge per severity,
   worst first. Zero levels are omitted; an all-zero tally reads "None" rather
   than three zeros, which would state "nothing here" three times.
   See specs/findings-by-severity.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
import type { Severity } from "@devdigest/ui";
import type { SeverityCounts } from "@devdigest/shared";
import { SEVERITY_ORDER } from "./constants";

export function SeverityBadges({
  counts,
  /** Style for the "None" fallback — callers own their own muted token. */
  noneStyle,
}: {
  counts: SeverityCounts;
  noneStyle?: React.CSSProperties;
}) {
  const t = useTranslations("prReview");
  const shown = SEVERITY_ORDER.filter((k) => counts[k] > 0);

  if (shown.length === 0) return <span style={noneStyle}>{t("findings.none")}</span>;

  return (
    <>
      {shown.map((k) => (
        <SeverityBadge key={k} severity={k as Severity} count={counts[k]} compact />
      ))}
    </>
  );
}

export default SeverityBadges;
