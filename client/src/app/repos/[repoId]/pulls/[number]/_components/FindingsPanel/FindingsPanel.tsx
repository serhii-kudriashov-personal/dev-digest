/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SeverityFilterBar } from "../SeverityFilterBar";
import { useFindingAction } from "@/lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { byConfidence, countBySeverity, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severities = [],
  onToggleSeverity,
  targetFindingId = null,
  targetFindingNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Page-wide severity selection (from `?severity=`); empty means all. */
  severities?: Severity[];
  onToggleSeverity?: (sev: Severity) => void;
  /**
   * The finding to jump to — focused, expanded and scrolled into view. Comes
   * from `?finding=<id>`: a severity chip in the diff opens this page in a new
   * browser tab, so the target arrives on a cold load. Ignored when this panel
   * does not hold it.
   */
  targetFindingId?: string | null;
  /**
   * Bumped per request, so asking for the SAME finding twice fires again. The
   * deep-link caller passes a constant (one load, one jump); it exists for an
   * in-place caller that can ask repeatedly.
   */
  targetFindingNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  // A card is uncontrolled until navigation forces it open; from then on its
  // state lives here, so the reader can still collapse it again. Same shape as
  // `SmartDiffViewer`'s `openByPath`.
  const [expandedById, setExpandedById] = React.useState<Record<string, boolean>>({});

  // Counts sit BETWEEN the two filters: after confidence, before severity. So
  // each chip's number is exactly the row count you get by lighting it alone.
  const confident = React.useMemo(() => byConfidence(findings, hideLow), [findings, hideLow]);
  const counts = React.useMemo(() => countBySeverity(confident), [confident]);
  const shown = React.useMemo(() => visibleFindings(confident, severities), [confident, severities]);

  const holdsTarget = targetFindingId != null && findings.some((f) => f.id === targetFindingId);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  /** The `id:nonce` this Effect has already acted on — see the comment below. */
  const jumped = React.useRef<string | null>(null);

  // Synchronises with the DOM (an external system), which is what makes an
  // Effect the right tool here rather than a derivation.
  React.useEffect(() => {
    if (!holdsTarget || targetFindingId == null) return;
    // `shown` has to be a dependency (the retry below needs the re-run), and it
    // changes identity on every accept/dismiss — so without this guard, acting
    // on ONE finding would yank the viewport back to the deep-linked target the
    // reader had already left. One jump per request; the nonce is what makes a
    // later request a new one.
    const key = `${targetFindingId}:${targetFindingNonce}`;
    if (jumped.current === key) return;

    const idx = shown.findIndex((f) => f.id === targetFindingId);
    // The panel holds the finding but a local filter is hiding it. `hideLow` is
    // the only one that can be — the deep link carries no `?severity=`, so the
    // page-wide selection is empty on that load — so lift it and let the new
    // `shown` re-run this. Deliberately NOT recorded in `jumped`: this pass did
    // not jump, and scrolling to a card that is not rendered is a silent no-op.
    if (idx === -1) {
      setHideLow(false);
      return;
    }
    jumped.current = key;
    setFocusIdx(idx);
    setExpandedById((prev) => ({ ...prev, [targetFindingId]: true }));
    // Scoped to this panel's list: several accordions are mounted at once, and
    // `data-finding-id` is unique per finding but the query must not wander into
    // a sibling run's cards.
    listRef.current
      ?.querySelector(`[data-finding-id="${targetFindingId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [holdsTarget, targetFindingId, targetFindingNonce, shown]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {onToggleSeverity && (
          <SeverityFilterBar counts={counts} selected={severities} onToggle={onToggleSeverity} />
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div ref={listRef} style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              expanded={expandedById[f.id]}
              onExpandedChange={(next) => setExpandedById((prev) => ({ ...prev, [f.id]: next }))}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
