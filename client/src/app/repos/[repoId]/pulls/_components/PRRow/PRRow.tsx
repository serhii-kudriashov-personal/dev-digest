/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta, Repo } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { FindingsCell } from "../FindingsCell";
import { relativeTime, sizeOf } from "../../helpers";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";

export function PRRow({
  pr,
  repoId,
  repo,
}: {
  pr: PrMeta;
  repoId: string;
  /** The owning repository — supplies the identifier prefix and the instance name (AC-26, AC-27, AC-31). */
  repo?: Pick<Repo, "provider" | "instance_label"> | null;
}) {
  const t = useTranslations("prReview");
  const tc = useTranslations("common");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            {tc("forge.identifier", { provider: repo?.provider ?? "github", number: pr.number })}
          </span>
          {repo && (
            <span style={s.rowInstance}>
              {tc("forge.onInstance", { instance: repo.instance_label })}
            </span>
          )}
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <FindingsCell pr={pr} />
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div className="tnum" style={s.costCell}>
        {formatCost(pr.cost_usd)}
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
