/* DocumentPreview — one document, rendered as Markdown, read-only.

   The content is fetched here rather than riding the listing: a 500-document
   list carrying every body would be enormous, and only the selected document is
   ever read. There is no edit mode and no save control — see ContextView's
   header comment for why writing into the mirror is not an option.

   Cross-route component (client/INSIGHTS.md 2026-08-02 "Cross-route components
   go in `src/components/`"): the repo-wide Project Context page and the agent
   and skill editors' Context tabs all open the same read-only preview. `onClose`
   is optional because only the two attachment screens present it as a
   dismissible panel — the Project Context page keeps it permanently docked
   beside the list, with nothing to close. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDoc } from "@/lib/hooks/context";
import { s } from "./styles";

export function DocumentPreview({
  repoId,
  path,
  onClose,
}: {
  repoId: string | null | undefined;
  path: string | null;
  onClose?: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useContextDoc(repoId, path);

  if (!path) return <div style={s.placeholder}>{t("preview.empty")}</div>;

  const closeButton = onClose ? (
    <button type="button" aria-label={t("preview.close")} style={s.close} onClick={onClose}>
      <Icon.X size={14} />
    </button>
  ) : null;

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.head}>
          <span className="mono" style={s.path}>
            {path}
          </span>
          {closeButton}
        </div>
        <div style={s.body}>
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={s.wrap}>
        <div style={s.head}>
          <span className="mono" style={s.path}>
            {path}
          </span>
          {closeButton}
        </div>
        <div style={s.body}>
          <ErrorState body={t("preview.loadError")} />
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span className="mono" style={s.path}>
          {data.path}
        </span>
        <Badge color="var(--text-muted)">{t("mode.preview")}</Badge>
        {data.truncated && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("docTruncated")}
          </Badge>
        )}
        {closeButton}
      </div>
      <div style={s.body}>
        <Markdown>{data.content}</Markdown>
      </div>
    </div>
  );
}
