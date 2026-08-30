"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@devdigest/ui";
import { AgentPicker, type AgentPickerAgent } from "@/components/agent-picker";
import { useAgents } from "@/lib/hooks/agents";
import { useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { s } from "./styles";
import type { PrDetail, RepoProvider } from "@/lib/types";

interface PrDetailHeaderProps {
  pr: PrDetail;
  prId: string | null;
  tab: string;
  findingsCount: number;
  /**
   * The change request's URL on its OWN forge, already admitted by
   * `safeExternalHref` (AC-25, AC-29). Null when the repository is not loaded
   * yet, or when the target failed the origin check — in which case NO
   * clickable element is rendered at all, rather than a disabled-looking one.
   */
  forgeUrl?: string | null;
  /** Instance the repository lives on — rendered as text in the action's name (AC-31). */
  instanceLabel?: string | null;
  /** Which forge, so the identifier prefix reads `#123` or `!123` (AC-27). */
  provider?: RepoProvider;
  onSetTab: (tab: string) => void;
  onRunStart: () => void;
  onRunsStarted: () => void;
}

export function PrDetailHeader({
  pr,
  prId,
  tab,
  findingsCount,
  forgeUrl,
  instanceLabel,
  provider = "github",
  onSetTab,
  onRunStart,
  onRunsStarted,
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const tc = useTranslations("common");
  const { repoId } = useParams<{ repoId: string }>();
  const { data: agentsData } = useAgents();
  const startRun = useStartMultiAgentRun();
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  const agents: AgentPickerAgent[] = useMemo(
    () => (agentsData ?? []).map((a) => ({ id: a.id, name: a.name, enabled: a.enabled })),
    [agentsData],
  );

  React.useEffect(() => {
    if (!pickerOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [pickerOpen]);

  const handleToggle = useCallback((agentId: string) => {
    setSelected((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(agents.map((a) => a.id));
  }, [agents]);

  const handleConfirm = useCallback(() => {
    if (!prId || selected.length === 0) return;
    onRunStart();
    startRun.mutate(
      { prId, agentIds: selected },
      {
        onSuccess: () => {
          onRunsStarted();
          setSelected([]);
          setPickerOpen(false);
        },
      },
    );
  }, [prId, selected, startRun, onRunStart, onRunsStarted]);

  const statusColor =
    pr.status === "merged"
      ? "var(--ok)"
      : pr.status === "closed"
        ? "var(--stale)"
        : "var(--warn)";

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              {tc("forge.identifier", { provider, number: pr.number })}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
              <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
            </span>
            <Badge dot bg="transparent" color={statusColor}>
              {pr.status}
            </Badge>
            {instanceLabel && (
              <span style={s.instanceChip}>
                {tc("forge.onInstance", { instance: instanceLabel })}
              </span>
            )}
          </div>
        </div>
        <div style={s.actions}>
          {forgeUrl && (
            <Button
              kind="ghost"
              size="sm"
              icon="ExternalLink"
              onClick={() => window.open(forgeUrl, "_blank", "noopener,noreferrer")}
            >
              {t("detail.viewOnForge", { instance: instanceLabel ?? "" })}
            </Button>
          )}
          {prId && (
            <div ref={popoverRef} style={s.pickerWrap}>
              <span
                title={pr.status === "merged" || pr.status === "closed" ? t("picker.mergedTooltip") : undefined}
                style={pr.status === "merged" || pr.status === "closed" ? { opacity: 0.6 } : undefined}
              >
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  iconRight="ChevronDown"
                  loading={startRun.isPending}
                  onClick={() => setPickerOpen((o) => !o)}
                >
                  {startRun.isPending ? t("picker.running") : t("picker.trigger")}
                </Button>
              </span>
              {pickerOpen && (
                <div style={s.pickerPanel}>
                  <AgentPicker
                    agents={agents}
                    selected={selected}
                    onToggle={handleToggle}
                    onSelectAll={handleSelectAll}
                    onConfirm={handleConfirm}
                    pending={startRun.isPending}
                    warnMerged={pr.status === "merged" || pr.status === "closed"}
                    configureHref={`/repos/${repoId}/multi-agent?pr=${prId}`}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {(pr.status === "merged" || pr.status === "closed") && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>{t("detail.mergedBanner", { provider, status: pr.status })}</span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: "Overview", icon: "FileText" },
          { key: "findings", label: "Agent runs", icon: "AlertOctagon", count: findingsCount || undefined },
          { key: "diff", label: "Files changed", icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
