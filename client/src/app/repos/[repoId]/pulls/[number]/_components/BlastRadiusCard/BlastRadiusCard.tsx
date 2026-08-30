"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Chip, EmptyState, SectionLabel } from "@devdigest/ui";
import type { BlastRadiusResponse, DownstreamImpact } from "@devdigest/shared";
import { blobUrl, safeExternalHref, type ForgeRepoRef } from "@/lib/forge-urls";
import { BlastGraph } from "./BlastGraph";
import { BLAST_VIEWS, STATE_BADGE, type BlastView } from "./constants";
import { s } from "./styles";

/**
 * What else this PR's diff could touch: the symbols its changed files declare,
 * who calls them, and which HTTP endpoints or crons those callers serve.
 *
 * Takes RESOLVED DATA plus flags, never a `prId` it fetches from — the owner of
 * the query is the tab that already holds the PR (`client/INSIGHTS.md`
 * 2026-08-02).
 *
 * Every number on screen is DERIVED during render from `blast`; none is stored
 * and no Effect syncs anything.
 */
interface BlastRadiusCardProps {
  blast: BlastRadiusResponse | null | undefined;
  loading: boolean;
  /** The PR's changed file paths — what decides in-app vs GitHub navigation. */
  changedPaths: Set<string>;
  repo: ForgeRepoRef | null;
  headSha: string | null;
  onOpenCaller: (path: string, line: number) => void;
}

export function BlastRadiusCard({
  blast,
  loading,
  changedPaths,
  repo,
  headSha,
  onOpenCaller,
}: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const tBrief = useTranslations("brief");
  const [view, setView] = React.useState<BlastView>("tree");

  if (loading || !blast) return null;

  /**
   * A server that predates L06 omits `state` entirely, and it cannot report
   * degradation it does not compute — so a missing value normalizes to `'full'`,
   * which silently loses the banner rather than showing a false alarm. The client
   * does not Zod-parse responses, so there is no runtime failure either way.
   */
  const state = blast.state ?? "full";
  const reason = blast.reason ?? null;

  const symbolCount = blast.changed_symbols.length;
  const callerCount = blast.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronCount = new Set(blast.downstream.flatMap((d) => d.crons_affected)).size;

  const badge = state === "full" ? null : STATE_BADGE[state];
  // "Nothing downstream" and "the index could not answer" are different answers.
  const isEmpty = state === "full" && callerCount === 0;

  return (
    <section>
      <SectionLabel
        icon="Workflow"
        right={
          <span
            role="group"
            aria-label={t("viewLabel")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {BLAST_VIEWS.map((candidate) => (
              <Chip key={candidate} active={view === candidate} onClick={() => setView(candidate)}>
                {t(`view.${candidate}`)}
              </Chip>
            ))}
          </span>
        }
      >
        {tBrief("block.blast")}
      </SectionLabel>

      <div style={s.card}>
        {badge && (
          <div style={s.header}>
            <Badge color={badge.color} bg={badge.bg} icon={badge.icon}>
              {t(`state.${state}`)}
            </Badge>
          </div>
        )}
        {reason && <div style={s.reason}>{t(`reason.${reason}`)}</div>}

        <div style={s.stats}>
          <Stat value={symbolCount} label={t("stat.symbols")} />
          <Stat value={callerCount} label={t("stat.callers")} />
          <Stat value={endpointCount} label={t("stat.endpoints")} />
          <Stat value={cronCount} label={t("stat.crons")} />
        </div>

        {/* The server's `summary` is DATA, not an i18n string — same class as
            `intent.intent`. It is deterministic server-side text. */}
        <div style={s.summary}>{blast.summary}</div>

        {isEmpty ? (
          <EmptyState
            icon="Workflow"
            title={t("empty.title")}
            body={symbolCount > 0 ? t("noDownstream", { count: symbolCount }) : t("empty.body")}
          />
        ) : view === "graph" ? (
          <BlastGraph
            downstream={blast.downstream}
            onOpenCaller={onOpenCaller}
            isInDiff={(path) => changedPaths.has(path)}
          />
        ) : (
          <div style={s.tree}>
            {blast.downstream.map((entry) => (
              <SymbolNode
                key={`${entry.file}:${entry.symbol}`}
                entry={entry}
                declFile={entry.file}
                changedPaths={changedPaths}
                repo={repo}
                headSha={headSha}
                onOpenCaller={onOpenCaller}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={s.stat}>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

/** One changed symbol, expandable to its callers and the facts they carry. */
function SymbolNode({
  entry,
  declFile,
  changedPaths,
  repo,
  headSha,
  onOpenCaller,
}: {
  entry: DownstreamImpact;
  declFile: string | null;
  changedPaths: Set<string>;
  repo: ForgeRepoRef | null;
  headSha: string | null;
  onOpenCaller: (path: string, line: number) => void;
}) {
  const t = useTranslations("blast");
  // A symbol with callers starts open; one with none is still listed, with a `0`
  // badge, so it is never silently dropped.
  const [open, setOpen] = React.useState(entry.callers.length > 0);

  return (
    <div style={s.node}>
      <button
        type="button"
        style={s.nodeHeader}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={s.nodeSymbol}>{entry.symbol}</span>
        {declFile && <span style={s.nodeFile}>{declFile}</span>}
        <span style={s.nodeSpacer} />
        <Badge>{t("callerCount", { count: entry.callers.length })}</Badge>
      </button>

      {open && (
        <div style={s.nodeBody}>
          {entry.callers.map((caller) => (
            <CallerRow
              key={`${caller.file}:${caller.line}`}
              file={caller.file}
              line={caller.line}
              inDiff={changedPaths.has(caller.file)}
              repo={repo}
              headSha={headSha}
              onOpenCaller={onOpenCaller}
            />
          ))}

          {(entry.endpoints_affected.length > 0 || entry.crons_affected.length > 0) && (
            <div style={s.facts}>
              {entry.endpoints_affected.map((endpoint) => (
                <Badge key={endpoint} mono icon="Globe">
                  {endpoint}
                </Badge>
              ))}
              {/* The stored string verbatim: `extractCrons` emits a raw cron
                  expression or `job:<kind>`, and a display name for a job exists
                  nowhere in the index — inventing one would be a UI guess. */}
              {entry.crons_affected.map((cron) => (
                <Badge key={cron} mono icon="Clock">
                  {cron}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One `file:line`.
 *
 * Blast callers are cross-file by construction and the declaring file is
 * excluded, while the Diff tab renders only the PR's own patches — so an in-app
 * jump is possible ONLY when the caller file is itself part of this PR. Outside
 * it, the honest affordance is the repository's OWN forge at the indexed commit
 * (AC-29); with no repository, or a target the origin check refuses (AC-25),
 * plain text and no clickable element at all.
 */
function CallerRow({
  file,
  line,
  inDiff,
  repo,
  headSha,
  onOpenCaller,
}: {
  file: string;
  line: number;
  inDiff: boolean;
  repo: ForgeRepoRef | null;
  headSha: string | null;
  onOpenCaller: (path: string, line: number) => void;
}) {
  const t = useTranslations("blast");
  const label = `${file}:${line}`;

  if (inDiff) {
    return (
      <button
        type="button"
        style={s.callerRow}
        aria-label={t("openInDiff", { path: file, line })}
        onClick={() => onOpenCaller(file, line)}
      >
        {label}
      </button>
    );
  }

  const href =
    repo && headSha ? safeExternalHref(blobUrl(repo, headSha, file, line), repo) : null;
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={s.callerRow}
        aria-label={t("openOnForge", { path: file, line, instance: repo!.instance_label })}
      >
        {label}
      </a>
    );
  }

  return <span style={s.callerPlain}>{label}</span>;
}
