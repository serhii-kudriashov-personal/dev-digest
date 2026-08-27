/* AgentPicker — the review-launch control (SPEC-05). Shared from birth by two
   routes (`frontend-ui-architecture` §1): the pull-request header (where the
   caller wraps it in its own small popover — see `PrDetailHeader.tsx`) and the
   Configure-run screen (where it is rendered inline as "the agent block").

   Takes resolved data and callbacks only, never an id it fetches itself
   (`frontend-ui-architecture` §4, `client/INSIGHTS.md` 2026-08-02) — so either
   caller can hand it whichever agent list it already holds. It lists EVERY
   agent, enabled or not, preserving the replaced review-launch dropdown's own
   behaviour (spec §Edge cases): a disabled agent can still be picked.

   The confirm action stays disabled and the count reads zero while nothing is
   checked (AC-2) — the caller does not need to compute that itself. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Icon } from "@devdigest/ui";
import { formatCost } from "@/lib/format";
import { agentAccent } from "./constants";
import { s } from "./styles";

/** Seconds-formatted duration, or an em dash for "not yet known" — never `0`
 *  (root `INSIGHTS.md` 2026-08-02), duplicated from `ConfigureRunPanel.tsx`
 *  rather than shared across this cross-route boundary (`frontend-ui-architecture` §2). */
function formatSeconds(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The minimal shape AgentPicker needs — deliberately narrower than the full
 *  `Agent` contract so either caller can build it from whatever it already
 *  fetched (`Agent[]` on the PR page, `AgentHistoryRow[]` on Configure run). */
export interface AgentPickerAgent {
  id: string;
  name: string;
  enabled: boolean;
  /** Last run's summary, when the caller already has one (Configure-run's
   *  history). Omitted callers just get a plainer card. */
  summary?: string | null;
  lastRun?: { durationMs: number | null; costUsd: number | null } | null;
}

export interface AgentPickerProps {
  agents: AgentPickerAgent[];
  selected: string[];
  onToggle: (agentId: string) => void;
  onSelectAll: () => void;
  onConfirm: () => void;
  /** The start request is in flight — disables the confirm action a second
   *  time and swaps its label (AC-3). */
  pending?: boolean;
  /** Merged/closed PR — dim the control and warn, but still allow running
   *  (kept from the replaced control's behaviour). */
  warnMerged?: boolean;
  /** "Configure run…" link target (AC-6). Omitted on the Configure-run screen
   *  itself, where the link would point back at the page already showing. */
  configureHref?: string | null;
}

export function AgentPicker({
  agents,
  selected,
  onToggle,
  onSelectAll,
  onConfirm,
  pending = false,
  warnMerged = false,
  configureHref = null,
}: AgentPickerProps) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const count = selected.length;

  if (agents.length === 0) {
    return (
      <div style={s.root}>
        <EmptyState
          icon="Cpu"
          title={t("picker.noAgentsTitle")}
          body={t("picker.noAgentsBody")}
          cta={t("picker.noAgentsCta")}
          onCta={() => router.push("/agents")}
        />
      </div>
    );
  }

  return (
    <div style={s.root}>
      {warnMerged && (
        <div style={s.mergedBanner}>
          <Icon.AlertTriangle size={13} />
          <span>{t("picker.mergedWarning")}</span>
        </div>
      )}
      <div style={s.header}>
        <span style={s.countLabel}>{t("picker.selectedCount", { count })}</span>
        <button type="button" onClick={onSelectAll} style={s.selectAllBtn}>
          {t("picker.selectAll")}
        </button>
      </div>
      <ul role="group" aria-label={t("picker.listLabel")} style={s.list}>
        {agents.map((a) => {
          const checked = selected.includes(a.id);
          const accent = agentAccent(a.id);
          const I = Icon[accent.icon];
          const stats =
            a.lastRun && (a.lastRun.durationMs != null || a.lastRun.costUsd != null)
              ? `${formatSeconds(a.lastRun.durationMs)} · ${formatCost(a.lastRun.costUsd)}`
              : null;
          return (
            <li key={a.id} style={s.card(accent.color, checked)}>
              <Checkbox
                checked={checked}
                onChange={() => onToggle(a.id)}
                label={
                  <span style={s.labelRow}>
                    <span style={s.iconBadge(accent.color)}>
                      <I size={14} />
                    </span>
                    <span style={s.cardBody}>
                      <span style={s.cardNameRow}>
                        <span style={s.cardName}>{a.name}</span>
                        {!a.enabled && <span style={s.disabledTag}>· {t("picker.agentDisabled")}</span>}
                      </span>
                      {a.summary && <span style={s.cardSummary}>{truncate(a.summary, 110)}</span>}
                    </span>
                    {stats && <span style={s.cardStats}>{stats}</span>}
                  </span>
                }
              />
            </li>
          );
        })}
      </ul>
      <div style={s.footer}>
        {configureHref && (
          <Link href={configureHref} style={s.configureLink}>
            {t("picker.configureRun")}
          </Link>
        )}
        <span style={s.spacer} />
        <Button kind="primary" size="sm" disabled={count === 0} loading={pending} onClick={onConfirm}>
          {pending ? t("picker.running") : t("picker.confirm", { count })}
        </Button>
      </div>
    </div>
  );
}
