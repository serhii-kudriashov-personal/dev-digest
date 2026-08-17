/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";
import { s as local } from "./styles";

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  // Absent on every trace written before L02 — each PromptBlock simply omits its
  // count rather than showing a wrong 0.
  const tokenCounts = trace.prompt_assembly.token_counts;
  // Absent (null OR the key missing) on every trace written before Project
  // Context. `specs_read` cannot answer this: it was required from the start and
  // every stored trace carries a literal `[]`, so an empty array there means
  // "nobody ever wrote it", not "nothing was read".
  const projectContext = trace.project_context;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {/* THREE states, not two. A trace stored before this feature has no
                  `project_context` key at all and genuinely does not know what was
                  read — that is "not recorded". A run that resolved and read
                  nothing is "none". Rendering the first as the second would claim
                  a fact the trace does not hold. */}
              {projectContext == null ? (
                <span style={s.specsNone}>{t("trace.config.notRecorded")}</span>
              ) : projectContext.read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                projectContext.read.map((path) => (
                  <span key={path} className="mono" style={s.spec}>
                    {path}
                  </span>
                ))
              )}
            </div>
          </Row>
          {projectContext != null && projectContext.skipped.length > 0 && (
            <Row label={t("trace.config.skipped")}>
              <div style={local.skippedWrap}>
                {projectContext.skipped.map((skip) => (
                  <span key={skip.path} className="mono" style={local.skipped}>
                    {t("trace.config.skippedEntry", {
                      path: skip.path,
                      reason: t(`trace.config.skipReason.${skip.reason}`),
                    })}
                  </span>
                ))}
              </div>
            </Row>
          )}
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} tokens={tokenCounts?.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} tokens={tokenCounts?.skills} />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} tokens={tokenCounts?.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} tokens={tokenCounts?.repo_map} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} tokens={tokenCounts?.specs} />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} tokens={tokenCounts?.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} tokens={tokenCounts?.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
