/* AgentLane — one member run's column (Columns mode) or tab body (Tabs mode)
   of a multi-agent run (SPEC-05). Agent identity and status are always TEXT
   plus icon, never colour alone (AC-47); a failed lane shows its reason and
   the trace affordance and renders no findings area at all — what tells it
   apart from a successful lane that simply found nothing (AC-33, AC-45,
   NFR-6). Every lane, failed or not, offers the trace (AC-30). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button } from "@devdigest/ui";
import type { AgentLane as AgentLaneRecord } from "@devdigest/shared";
import { MultiAgentFindingCard } from "../MultiAgentFindingCard";
import { STATUS_ICON, STATUS_COLOR, laneAccentColor, verdictColor } from "./constants";
import { s } from "./styles";

/** Small progress ring for a lane's score — decorative only, the number
 *  itself (real DOM text) already carries the information (AC-47 unaffected:
 *  that AC binds lane *status*, not this numeric score). */
function ScoreRing({ score, accent }: { score: number; accent: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <div style={s.scoreRing}>
      <svg width={28} height={28} viewBox="0 0 28 28">
        <circle cx={14} cy={14} r={r} fill="none" stroke="var(--border)" strokeWidth={2.5} />
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          transform="rotate(-90 14 14)"
        />
      </svg>
      <span className="tnum" style={s.scoreRingNum}>
        {score}
      </span>
    </div>
  );
}

export function AgentLane({
  lane,
  prId,
  repoId,
  prNumber,
  multiAgentRunId,
  onOpenTrace,
}: {
  lane: AgentLaneRecord;
  prId: string;
  repoId: string;
  prNumber?: number | null;
  multiAgentRunId: string;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  const statusLabel: Record<AgentLaneRecord["status"], string> = {
    queued: t("lane.queued"),
    running: t("lane.running"),
    done: t("lane.done"),
    failed: t("lane.failed"),
    cancelled: t("lane.cancelled"),
  };
  // The announced word for "done" is the verdict when one was reached — more
  // informative than the generic status word, and still text (AC-47).
  const announcedStatus =
    lane.status === "done" && lane.verdict ? lane.verdict.replace("_", " ") : statusLabel[lane.status];
  const announcement = t("lane.statusAnnouncement", {
    agent: lane.agent_name,
    status: announcedStatus,
  });

  const accent = laneAccentColor(lane.agent_id, lane.agent_name);

  return (
    <div style={s.lane(accent)}>
      <div style={s.header}>
        <span style={s.agentName}>{lane.agent_name}</span>
        {lane.model && <span style={s.meta}>{lane.model}</span>}
        <span style={s.spacer} />
        {lane.status === "done" ? (
          lane.verdict && (
            <Badge color={verdictColor(lane.verdict)} bg="transparent">
              {lane.verdict.replace("_", " ")}
            </Badge>
          )
        ) : (
          <Badge icon={STATUS_ICON[lane.status]} color={STATUS_COLOR[lane.status]} bg="transparent">
            {statusLabel[lane.status]}
          </Badge>
        )}
        {lane.status === "done" && lane.score != null && <ScoreRing score={lane.score} accent={accent} />}
        {/* Announces a settle (queued/running → done/failed/cancelled) to
            assistive technology; sighted users already see the badge above. */}
        <span role="status" aria-live="polite" style={s.srOnly}>
          {announcement}
        </span>
        <Button
          kind="ghost"
          size="sm"
          icon="Eye"
          aria-label={t("viewTrace")}
          onClick={() => onOpenTrace(lane.run_id)}
        >
          {t("viewTrace")}
        </Button>
      </div>

      <div style={s.body}>
        {lane.status === "failed" ? (
          <div style={s.errorNote}>{lane.error}</div>
        ) : (
          <>
            {lane.summary ? (
              <div style={s.summary}>{lane.summary}</div>
            ) : (
              lane.status === "done" && <div style={s.emptyNote}>{t("tabs.noSummary")}</div>
            )}
            {lane.status === "done" &&
              (lane.findings.length === 0 ? (
                <div style={s.emptyNote}>{t("lane.noFindings")}</div>
              ) : (
                <div style={s.findingsList}>
                  {lane.findings.map((f) => (
                    <MultiAgentFindingCard
                      key={f.id}
                      finding={f}
                      agentName={lane.agent_name}
                      prId={prId}
                      repoId={repoId}
                      prNumber={prNumber}
                      multiAgentRunId={multiAgentRunId}
                    />
                  ))}
                  {lane.findings_total > lane.findings.length && (
                    <div style={s.capsNote}>
                      <Icon.Filter size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      {t("caps.findingsShown", {
                        shown: lane.findings.length,
                        total: lane.findings_total,
                      })}
                    </div>
                  )}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
