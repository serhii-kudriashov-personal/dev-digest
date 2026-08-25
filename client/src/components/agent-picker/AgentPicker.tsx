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
import { s } from "./styles";

/** The minimal shape AgentPicker needs — deliberately narrower than the full
 *  `Agent` contract so either caller can build it from whatever it already
 *  fetched (`Agent[]` on the PR page, `AgentHistoryRow[]` on Configure run). */
export interface AgentPickerAgent {
  id: string;
  name: string;
  enabled: boolean;
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
        {agents.map((a) => (
          <li key={a.id}>
            <Checkbox
              checked={selected.includes(a.id)}
              onChange={() => onToggle(a.id)}
              label={
                <span>
                  {a.name}
                  {!a.enabled && <span style={s.disabledTag}> · {t("picker.agentDisabled")}</span>}
                </span>
              }
            />
          </li>
        ))}
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
