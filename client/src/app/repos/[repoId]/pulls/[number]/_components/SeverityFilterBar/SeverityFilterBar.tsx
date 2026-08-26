/* SeverityFilterBar — "CRITICAL 3 · WARNING 5 · SUGGESTION 2" as clickable
   chips. Counts are PER RUN; the selection they drive is shared by every run on
   the page and lives in `?severity=`. See specs/findings-by-severity.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, SEV } from "@devdigest/ui";
import type { Severity, SeverityCounts } from "@devdigest/shared";
import { FILTER_SEVERITIES } from "./constants";
import { s } from "./styles";

export function SeverityFilterBar({
  counts,
  selected,
  onToggle,
}: {
  /** This run's tally, already past the confidence filter. */
  counts: SeverityCounts;
  /** Page-wide selection; empty means "show everything". */
  selected: Severity[];
  onToggle: (sev: Severity) => void;
}) {
  const t = useTranslations("prReview");
  return (
    <div role="group" aria-label={t("panel.severityFilter")} style={s.bar}>
      {FILTER_SEVERITIES.map((sev) => (
        <span key={sev} style={s.chip(counts[sev] === 0)}>
          <Chip
            active={selected.includes(sev)}
            onClick={() => onToggle(sev)}
            icon={SEV[sev].icon}
            color={SEV[sev].c}
            count={counts[sev]}
          >
            {t(`panel.severity.${sev}`)}
          </Chip>
        </span>
      ))}
    </div>
  );
}

export default SeverityFilterBar;
