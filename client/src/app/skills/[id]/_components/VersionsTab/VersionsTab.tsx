/* VersionsTab — the body's history, with a diff against the current text and a
   restore.

   Restore APPENDS: the server writes a new version carrying the old body rather
   than rewinding, because the subtitle's promise (past eval runs stay reproducible
   against the text they scored) only holds if no version is ever rewritten. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { diffLines, diffStat } from "./helpers";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffFor, setDiffFor] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={180} />;

  const rows = versions ?? [];
  if (rows.length === 0) return <p style={s.empty}>{t("editor.versionsEmpty")}</p>;

  const shown = rows.find((v) => v.version === diffFor);
  // Diffed against the CURRENT body rather than the adjacent version: the
  // question the button answers is "what would restoring this change?".
  const lines = shown ? diffLines(shown.body, skill.body) : [];
  const stat = diffStat(lines);

  const doRestore = (version: number) =>
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) => {
          setDiffFor(null);
          toast.success(t("editor.restoredToast", { from: version, version: data.version }));
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.versionsTitle")}</h2>
        <Badge color="var(--text-secondary)">
          {t("editor.versionCount", { count: rows.length })}
        </Badge>
      </div>
      <p style={s.subtitle}>{t("editor.versionsSubtitle")}</p>

      {rows.map((v) => {
        const isCurrent = v.version === skill.version;
        return (
          <div key={v.version}>
            <div style={s.row(isCurrent)}>
              <Badge color={isCurrent ? "var(--accent-text)" : "var(--text-secondary)"} mono>
                {t("editor.versionLabel", { version: v.version })}
              </Badge>
              <div style={s.rowText}>
                <div style={v.message ? s.message : s.noMessage}>
                  {v.message || t("editor.noVersionMessage")}
                </div>
                <div style={s.date}>{new Date(v.created_at).toLocaleString()}</div>
              </div>
              {isCurrent ? (
                <Badge color="var(--ok)" dot>
                  {t("editor.current")}
                </Badge>
              ) : (
                <div style={s.actions}>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="Eye"
                    onClick={() => setDiffFor(diffFor === v.version ? null : v.version)}
                  >
                    {t("editor.diff")}
                  </Button>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="RefreshCw"
                    disabled={restore.isPending}
                    onClick={() => doRestore(v.version)}
                  >
                    {t("editor.restore")}
                  </Button>
                </div>
              )}
            </div>

            {diffFor === v.version && (
              <div style={s.diffBox}>
                <div style={s.diffHead}>
                  <span>
                    {t("editor.diffHeader", { version: v.version, current: skill.version })}
                  </span>
                  <span style={s.diffStat}>
                    <span style={{ color: "var(--ok)" }}>+{stat.added}</span>{" "}
                    <span style={{ color: "var(--crit)" }}>−{stat.removed}</span>
                  </span>
                </div>
                <div className="mono" style={s.diffBody}>
                  {lines.map((line, i) => (
                    <div key={i} style={s.diffLine(line.op)}>
                      <span style={s.diffSign}>
                        {line.op === "add" ? "+" : line.op === "del" ? "−" : " "}
                      </span>
                      <span>{line.text || " "}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
