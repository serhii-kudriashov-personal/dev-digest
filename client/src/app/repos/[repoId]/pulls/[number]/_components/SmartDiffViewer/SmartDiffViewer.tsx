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
  lineAnchorId,
  type DiffCommentApi,
  type DiffFindingsApi,
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
}

/** Which file was asked for, and a sequence number so a repeat click re-fires. */
interface ScrollTarget {
  path: string;
  line: number;
  seq: number;
}

export function SmartDiffViewer({ groups, files, findings, commenting }: SmartDiffViewerProps) {
  const t = useTranslations("brief");

  const filesByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const file of files) map.set(file.path, file);
    return map;
  }, [files]);

  // A card is uncontrolled until something forces it open; from then on its
  // state lives here, so the reader can still collapse it again.
  const [openByPath, setOpenByPath] = React.useState<Record<string, boolean>>({});
  const [target, setTarget] = React.useState<ScrollTarget | null>(null);

  // The ONE legitimate Effect here: it synchronises with the DOM, which is an
  // external system. Opening the card happens in the click handler below, and
  // React batches it with `setTarget`, so by the time this runs the line has
  // been rendered and can be found. `seq` is what makes a SECOND click on the
  // same badge scroll again.
  React.useEffect(() => {
    if (!target) return;
    document
      .getElementById(lineAnchorId(target.path, target.line))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [target]);

  const goToFinding = (path: string, line: number) => {
    setOpenByPath((prev) => ({ ...prev, [path]: true }));
    setTarget((prev) => ({ path, line, seq: (prev?.seq ?? 0) + 1 }));
  };

  const findingsApi: DiffFindingsApi = { findings };

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
                open={openByPath[entry.path]}
                onOpenChange={(next) =>
                  setOpenByPath((prev) => ({ ...prev, [entry.path]: next }))
                }
                onGoToFinding={goToFinding}
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
