/* DocumentList — the discovered documents, one selectable row each.

   Selection only. No control on this list writes anything: the mirror is a
   read-only copy of the repository.

   Every badge carries a WORD as well as a colour — the root label, "missing",
   the truncation marker — so the row is readable without colour perception. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { s } from "./styles";

export function DocumentList({
  documents,
  selected,
  onSelect,
}: {
  documents: ContextDocument[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");
  return (
    <div style={s.wrap}>
      <div style={s.heading}>{t("list.heading")}</div>
      {documents.map((doc) => (
        <button
          key={doc.path}
          type="button"
          onClick={() => onSelect(doc.path)}
          aria-current={doc.path === selected}
          style={s.row(doc.path === selected)}
        >
          <span className="mono" style={s.path}>
            {doc.path}
          </span>
          <span style={s.dir}>{doc.dir}</span>
          <span style={s.badges}>
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Folder" mono>
              {t("rootLabel", { root: doc.root })}
            </Badge>
            {/* An unknown estimate renders as nothing at all, never as "~0 tok". */}
            {doc.est_tokens != null && (
              <Badge color="var(--text-secondary)" mono>
                {t("tokenEstimate", { count: doc.est_tokens })}
              </Badge>
            )}
            {doc.truncated && (
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("docTruncated")}
              </Badge>
            )}
            {doc.missing && (
              <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
                {t("missing")}
              </Badge>
            )}
            <Badge color="var(--text-muted)" icon="Users">
              {t("agentCount", { count: doc.agent_count })}
            </Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
