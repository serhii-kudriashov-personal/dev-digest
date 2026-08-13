"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type {
  FindingRecord,
  PrFile,
  SmartDiffFile,
  SmartDiffGroup,
  SmartDiffRole,
} from "@devdigest/shared";
import {
  FileCard,
  type DiffCommentApi,
  type DiffFindingsApi,
  type DiffLineTargetApi,
} from "@/components/diff-viewer";
import { ROLE_COLOR, ROLE_DEFAULT_OPEN } from "./constants";
import { s, squareFor } from "./styles";

/**
 * The reviewer-ordered diff: the PR's files grouped `core → wiring →
 * boilerplate` and, inside each group, ordered by how much a reviewer needs to
 * look at them.
 *
 * Takes RESOLVED DATA — groups, files, findings — and never a `prId` it fetches
 * from. The tab that renders it already owns both queries, and pushing them in
 * here would make "when to fetch" this component's problem.
 *
 * The grouping and the order come from the server; nothing here re-sorts or
 * re-classifies, so the two can never disagree.
 */
interface SmartDiffViewerProps {
  groups: SmartDiffGroup[];
  /** The PR's files, for their `patch` text. Keyed by path against `groups`. */
  files: PrFile[];
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  /**
   * Clicking a per-line severity chip. The page opens that finding's card in a
   * new browser tab; this component only reports which one was clicked.
   *
   * Without it the chips render as plain badges — the overlay is read-only
   * either way, so a caller that has nowhere to send the reader simply omits it
   * (`CodeLine` branches on its presence).
   */
  onFindingClick?: (finding: FindingRecord) => void;
  /**
   * Card-open + scroll-to-line orchestration, owned by the tab that renders this
   * viewer — the same instance also serves the plain `DiffViewer` and the
   * Blast Radius card's `?goto=` handoff, so a target set from either place lands
   * on whichever viewer is on screen.
   */
  lineTarget: DiffLineTargetApi;
}

export function SmartDiffViewer({
  groups,
  files,
  findings,
  commenting,
  onFindingClick,
  lineTarget,
}: SmartDiffViewerProps) {
  const t = useTranslations("brief");

  const filesByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const file of files) map.set(file.path, file);
    return map;
  }, [files]);

  const findingsApi: DiffFindingsApi = { findings, onFindingClick };

  return (
    <div style={s.list}>
      {groups.map((group) => (
        <section key={group.role} style={s.group}>
          <header style={s.groupHeader}>
            <span style={squareFor(ROLE_COLOR[group.role])} />
            <span style={s.groupTitle}>{t(`smartDiff.roles.${group.role}.title`)}</span>
            <span style={s.groupSubtitle}>{t(`smartDiff.roles.${group.role}.subtitle`)}</span>
            <span style={s.groupCount}>{t("smartDiff.filesCount", { count: group.files.length })}</span>
          </header>

          {group.files.length === 0 ? (
            <div style={s.empty}>{t("smartDiff.emptyGroup")}</div>
          ) : (
            group.files.map((entry) => (
              <SmartDiffRow
                key={entry.path}
                entry={entry}
                role={group.role}
                file={filesByPath.get(entry.path)}
                open={lineTarget.openByPath[entry.path]}
                onOpenChange={(next) => lineTarget.setOpen(entry.path, next)}
                onGoToFinding={lineTarget.goTo}
                findings={findingsApi}
                commenting={commenting}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

/** One file: its card, plus the badge that jumps to its first flagged line. */
function SmartDiffRow({
  entry,
  role,
  file,
  open,
  onOpenChange,
  onGoToFinding,
  findings,
  commenting,
}: {
  entry: SmartDiffFile;
  role: SmartDiffRole;
  file: PrFile | undefined;
  open: boolean | undefined;
  onOpenChange: (open: boolean) => void;
  onGoToFinding: (path: string, line: number) => void;
  findings: DiffFindingsApi;
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("brief");
  const count = entry.finding_lines.length;
  const firstLine = entry.finding_lines[0];

  // Boilerplate stays collapsed whatever it contains. Elsewhere a flagged file
  // opens; everything else falls through to the viewer's own size heuristic,
  // which stays the single definition of "small enough to expand".
  const defaultOpen = ROLE_DEFAULT_OPEN[role] ? (count > 0 ? true : undefined) : false;

  // The smart diff and the PR files are two requests; a file can be in one and
  // not the other if the PR refreshed in between. Render the header anyway.
  const card: PrFile = file ?? {
    path: entry.path,
    additions: entry.additions,
    deletions: entry.deletions,
    patch: null,
  };

  return (
    <div style={s.fileRow}>
      <div style={s.fileCardWrap}>
        <FileCard
          file={card}
          commenting={commenting}
          findings={findings}
          defaultOpen={defaultOpen}
          open={open}
          onOpenChange={onOpenChange}
        />
      </div>
      {count > 0 && firstLine !== undefined && (
        <button
          type="button"
          style={s.findingsBtn}
          aria-label={t("smartDiff.goToFindings", { count, path: entry.path })}
          onClick={() => onGoToFinding(entry.path, firstLine)}
        >
          {t("smartDiff.findings", { count })}
        </button>
      )}
    </div>
  );
}
