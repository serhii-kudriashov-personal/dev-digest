/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";
// Sibling file, not the module's own barrel — importing through `../index` from
// inside the module is a cycle (`frontend-ui-architecture` §7).
import { type DiffLineTargetApi } from "../useDiffLineTarget";

export function DiffViewer({
  files,
  commenting,
  lineTarget,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /**
   * Optional: lets a caller open one file's card and scroll to a line in it.
   * Omitted, this renders exactly as before — every card is uncontrolled.
   */
  lineTarget?: DiffLineTargetApi;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          open={lineTarget?.openByPath[f.path]}
          onOpenChange={lineTarget ? (next) => lineTarget.setOpen(f.path, next) : undefined}
        />
      ))}
    </div>
  );
}
