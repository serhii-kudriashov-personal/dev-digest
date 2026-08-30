/* PR list screen — /repos/:repoId/pulls. Ported from screen_dashboard.jsx;
   fetches GET /repos/:id/pulls (F1). Filters/sort live in query (?status&sort). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Skeleton,
  EmptyState,
  ErrorState,
  AutoTriggerStatus,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { RepoIdentity } from "@/components/repo-identity";
import { usePulls, useRefreshRepo } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { COLUMN_KEYS, SKELETON_ROWS } from "../../constants";
import { s } from "../../styles";
import { PRRow } from "../PRRow";
import { FilterBar } from "../FilterBar";
import { DEFAULT_STATUS } from "./constants";
import { countNeedsReview, countOpen, filterAndSortPulls } from "./helpers";

export function PullsView() {
  const t = useTranslations("prReview");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isLoading, isError, error, refetch } = usePulls(repoId);
  const refresh = useRefreshRepo();

  const status = search.get("status") ?? DEFAULT_STATUS;
  const setStatus = (k: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("status", k); // always explicit so "all" sticks over the needs_review default
    router.replace(`/repos/${repoId}/pulls?${sp.toString()}`);
  };

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("newest");

  const filtered = filterAndSortPulls(pulls ?? [], status, query, sort);
  const repoName = activeRepo?.full_name ?? repoId;
  const openCount = countOpen(pulls ?? []);
  const needsReviewCount = countNeedsReview(pulls ?? []);
  // Vocabulary is a property of the OWNING repository, not of the screen
  // (AC-26): "pull request" on GitHub, "merge request" on GitLab. Until the
  // repos list resolves, the GitHub wording is the honest default — it is what
  // every pre-feature workspace has (AC-19).
  const provider = activeRepo?.provider ?? "github";
  const instance = activeRepo?.instance_label ?? "";
  // AC-44 / NFR-7 — three states, not two. A list that is EMPTY because the
  // last sync failed is not the same thing as a repository with no open change
  // requests, and neither is the same as "still loading". `last_sync_error` is
  // what makes the third state expressible without a new endpoint.
  const syncError = activeRepo?.last_sync_error ?? null;

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("list.breadcrumb", { provider }) }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("list.breadcrumb", { provider }) }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("list.title", { provider })}</h1>
          <p style={s.pageSubtitle}>
            {pulls
              ? t("list.summary", { open: openCount, needsReview: needsReviewCount })
              : t("list.loading", { provider })}
          </p>
          {activeRepo && <RepoIdentity repo={activeRepo} />}
        </div>
        <div style={s.headerActions}>
          <AutoTriggerStatus on={false} />
        </div>
      </div>

      <div style={s.tableCard}>
        <FilterBar
          active={status}
          onActive={setStatus}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          onRefresh={() => refresh.mutate(repoId)}
          refreshing={refresh.isPending}
          provider={provider}
        />
        {syncError && (
          <div role="status" style={s.syncErrorBanner}>
            <strong>{t("list.staleTitle", { instance })}</strong>{" "}
            <span>{t("list.staleBody", { reason: syncError })}</span>
          </div>
        )}
        <div style={s.headRow}>
          {COLUMN_KEYS.map((key, i) => (
            <div key={key} style={s.headCell(key === "cost" || i === COLUMN_KEYS.length - 1)}>
              {t(`list.columns.${key}`, { provider })}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("list.errorTitle", { provider })}
            body={error instanceof ApiError ? error.message : t("list.errorBody")}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="GitPullRequest"
            title={t("list.emptyTitle", { provider })}
            body={
              status === "all"
                ? t("list.emptyAllBody", { provider, instance })
                : t("list.emptyStatusBody", { provider, status })
            }
          />
        ) : (
          filtered.map((pr) => (
            <PRRow key={pr.number} pr={pr} repoId={repoId} repo={activeRepo} />
          ))
        )}
      </div>
    </AppShell>
  );
}
