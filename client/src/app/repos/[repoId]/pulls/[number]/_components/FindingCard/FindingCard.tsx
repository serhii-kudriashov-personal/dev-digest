/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  expanded: expandedProp,
  onExpandedChange,
  onAction,
  pending,
  repoFullName,
  headSha,
  onCreateEvalCase,
  creatingEvalCase,
}: {
  f: FindingRecord;
  focused?: boolean;
  /** Initial expanded state when uncontrolled. */
  defaultExpanded?: boolean;
  /**
   * Controlled expanded state. When passed it WINS over `defaultExpanded`, so a
   * caller that has to force a card open — navigating here from a severity chip
   * in the diff — can, without every other caller owning the state. Same
   * uncontrolled/controlled pair as `FileCard`.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * L06, SPEC-04 — AC-1…AC-9: freeze this finding into an eval case. Optional:
   * omitted, the third action is not rendered at all (used outside a PR view
   * that has nowhere to send the confirmation).
   */
  onCreateEvalCase?: () => void;
  creatingEvalCase?: boolean;
}) {
  const t = useTranslations("prReview");
  const [uncontrolledExpanded, setUncontrolledExpanded] = React.useState(defaultExpanded ?? false);
  const expanded = expandedProp ?? uncontrolledExpanded;
  const toggleExpanded = () => {
    const next = !expanded;
    if (expandedProp === undefined) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={toggleExpanded} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {onCreateEvalCase && (
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={!muted || creatingEvalCase}
                title={!muted ? t("finding.addToEvalsDisabledReason") : undefined}
                aria-label={t("finding.addToEvals")}
                onClick={() => onCreateEvalCase()}
              >
                {t("finding.addToEvals")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
