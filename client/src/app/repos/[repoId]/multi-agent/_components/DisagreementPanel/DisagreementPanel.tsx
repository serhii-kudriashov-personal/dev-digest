/* DisagreementPanel — "Where agents disagree" (SPEC-05). Rendered OUTSIDE the
   Columns/Tabs mode switch by `MultiAgentResults`, so both modes show the
   identical section with the identical filter state (AC-28) — this component
   never learns which mode is active. A did-not-flag entry states only that,
   with no rationale attributed to the silent agent (AC-25, Row 12 defect A).
   The conflicts-only filter is derived during render, never `useState` +
   `useEffect` over a copy of `locations`. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Toggle, SeverityBadge, type Severity } from "@devdigest/ui";
import type { GroupedLocation } from "@devdigest/shared";
import { s } from "./styles";

export function DisagreementPanel({
  locations,
  locationsTotal,
  completedLaneCount,
  repoId,
  prNumber,
}: {
  locations: GroupedLocation[];
  /** True count behind `locations`, which the server caps (NFR-3). */
  locationsTotal: number;
  completedLaneCount: number;
  repoId: string;
  prNumber?: number | null;
}) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>{t("conflicts.title")}</span>
        <span style={s.spacer} />
        {completedLaneCount >= 2 && (
          <label style={s.toggleLabel}>
            {t("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
          </label>
        )}
      </div>

      <div style={s.body}>
        {completedLaneCount < 2 ? (
          <div style={s.emptyNote}>{t("state.needsTwoRuns")}</div>
        ) : (
          <DisagreementList
            locations={onlyConflicts ? locations.filter((l) => l.conflict) : locations}
            locationsTotal={locationsTotal}
            rawShownCount={locations.length}
            repoId={repoId}
            prNumber={prNumber}
          />
        )}
      </div>
    </div>
  );
}

function DisagreementList({
  locations,
  locationsTotal,
  rawShownCount,
  repoId,
  prNumber,
}: {
  locations: GroupedLocation[];
  locationsTotal: number;
  rawShownCount: number;
  repoId: string;
  prNumber?: number | null;
}) {
  const t = useTranslations("runs");

  if (locations.length === 0) {
    return <div style={s.emptyNote}>{t("conflicts.empty")}</div>;
  }

  return (
    <>
      {locations.map((loc) => {
        const key = `${loc.file}:${loc.start_line}:${loc.end_line}`;
        const lineRange = loc.start_line === loc.end_line ? `${loc.start_line}` : `${loc.start_line}-${loc.end_line}`;
        const gotoHref = `/repos/${repoId}/pulls/${prNumber}?tab=diff&goto=${encodeURIComponent(
          `${loc.file}:${loc.start_line}`,
        )}`;
        return (
          <div key={key} style={s.location}>
            <div style={s.locationHeader}>
              {prNumber != null ? (
                <Link href={gotoHref} className="mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {loc.file}:{lineRange}
                </Link>
              ) : (
                <span className="mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {loc.file}:{lineRange}
                </span>
              )}
            </div>
            <div style={s.stancesGrid}>
              {loc.stances.map((stance) => (
                <div key={stance.run_id} style={s.stanceCol}>
                  <span style={s.stanceAgent}>{stance.agent_name}</span>
                  {stance.flagged ? (
                    <SeverityBadge severity={stance.severity as Severity} />
                  ) : (
                    <span style={s.didNotFlagRow}>
                      <span style={s.didNotFlagDot} />
                      <span style={s.didNotFlag}>{t("conflicts.didNotFlag")}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {locationsTotal > rawShownCount && (
        <div style={s.capsNote}>{t("caps.locationsShown", { shown: rawShownCount, total: locationsTotal })}</div>
      )}
    </>
  );
}
