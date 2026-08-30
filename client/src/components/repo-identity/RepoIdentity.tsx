/* RepoIdentity — "which repository, on which forge", as TEXT.
   SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) — AC-31, AC-33.

   Shared rather than route-local because three unrelated route trees render it:
   the repository card on `/`, the change-request list on `/repos/:id/pulls`,
   and the change-request detail header. The cross-route promotion rule fires on
   a COMPONENT, not only on a pure helper (`client/INSIGHTS.md` 2026-08-16), so
   the whole folder lives under `src/components/<kebab>/`
   (`frontend-ui-architecture` §1/§3).

   Two rules it exists to satisfy:
   - The provider and instance are TEXT inside the accessible name — never an
     icon and never a colour alone (AC-31). Visible text is the accessible name,
     which is why there is no `aria-label` here doing the work invisibly.
   - A long namespace path is truncated from the FRONT, and the full path stays
     reachable ON SCREEN: a `title` plus a visible expand control, not a tooltip
     alone (AC-33). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Repo } from "@/lib/types";
import { MAX_PATH_SEGMENTS, TRUNCATION_MARK } from "./constants";
import { truncateNamespace } from "./helpers";
import { s } from "./styles";

/** The repository fields this component reads. Any `Repo` satisfies it. */
export type RepoIdentityRepo = Pick<Repo, "provider" | "namespace_path" | "instance_label">;

export function RepoIdentity({
  repo,
  maxSegments = MAX_PATH_SEGMENTS,
}: {
  repo: RepoIdentityRepo;
  maxSegments?: number;
}) {
  const t = useTranslations("common");
  const [expanded, setExpanded] = React.useState(false);

  // Derived during render from props + one piece of genuinely local UI state.
  // Nothing here is mirrored into state by an Effect ("Derive, Don't Store").
  const full = repo.namespace_path;
  const { shown, truncated } = truncateNamespace(full, maxSegments);
  const collapsed = truncated && !expanded;

  return (
    <span style={s.root}>
      <span className="mono" style={s.path} title={full}>
        {collapsed ? `${TRUNCATION_MARK}${shown}` : full}
      </span>
      {truncated && (
        <button
          type="button"
          style={s.expand}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("forge.collapsePath", { path: full })
              : t("forge.expandPath", { path: full })
          }
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "−" : "…"}
        </button>
      )}
      <span style={s.instance}>{t("forge.onInstance", { instance: repo.instance_label })}</span>
    </span>
  );
}

export default RepoIdentity;
