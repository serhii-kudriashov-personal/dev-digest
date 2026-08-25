/* CiRunsView — the CI Runs screen (SPEC-05, `/ci-runs`). The interactive leaf
   under a thin, non-`'use client'` `page.tsx` (frontend-ui-architecture §9).

   Renders straight from `useCiRuns()` — no local copy of the list. Refresh is
   a separate mutation (`useRefreshCiRuns`) whose failure is surfaced BESIDE
   the list, never in place of it (NFR-5): a refresh that cannot reach GitHub
   must not make already-recorded runs disappear. */
"use client";

import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, MonoLink, Skeleton } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { ciRunPrUrl, formatCiCost, formatCiDuration, hasNoResultYet } from "./helpers";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const unknown = t("runs.unknownCost");
  const { data: runs, isLoading, isError, error, refetch } = useCiRuns();
  const refresh = useRefreshCiRuns();

  const crumb = [{ label: t("page.crumb") }];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("runs.title")}
          body={error instanceof ApiError ? error.message : t("exportWizard.error.unknownReason")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  if (isLoading || !runs) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.wrap}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            <div style={s.title}>{t("runs.title")}</div>
            <div style={s.subtitle}>{t("runs.subtitle")}</div>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>

        {refresh.isError && (
          <div role="alert" aria-live="polite" style={s.refreshError}>
            <Icon.AlertTriangle size={14} />
            {refresh.error instanceof ApiError ? refresh.error.message : t("exportWizard.error.unknownReason")}
          </div>
        )}

        {runs.length === 0 ? (
          <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>{t("runs.table.repository")}</th>
                <th style={s.th}>{t("runs.table.pullRequest")}</th>
                <th style={s.th}>{t("runs.table.agent")}</th>
                <th style={s.th}>{t("runs.table.status")}</th>
                <th style={s.th}>{t("runs.table.findings")}</th>
                <th style={s.th}>{t("runs.table.cost")}</th>
                <th style={s.th}>{t("runs.table.duration")}</th>
                <th style={s.th}>{t("runs.table.source")}</th>
                <th style={s.th}>{t("runs.table.jobLink")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <CiRunRow key={run.id} run={run} unknown={unknown} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function CiRunRow({ run, unknown }: { run: CiRun; unknown: string }) {
  const t = useTranslations("ci");
  const prUrl = ciRunPrUrl(run);
  const noResult = hasNoResultYet(run);

  return (
    <tr>
      <td className="mono" style={{ ...s.td, ...s.repo }}>
        {run.repo ?? unknown}
      </td>
      <td style={s.td}>
        {prUrl ? <MonoLink href={prUrl}>{t("runs.viewPr")}</MonoLink> : <span style={s.dash}>{unknown}</span>}
      </td>
      <td style={s.td}>{run.agent ?? unknown}</td>
      <td style={s.td}>
        {noResult
          ? t("runs.noResultYet")
          : run.status === "no_findings"
            ? t("runs.status.noFindings")
            : t("runs.status.succeeded")}
      </td>
      <td style={s.td}>{run.findings_count ?? unknown}</td>
      <td style={s.td}>{formatCiCost(run.cost_usd, unknown)}</td>
      <td style={s.td}>{formatCiDuration(run.duration_s, unknown)}</td>
      <td style={s.td}>{run.source === "local" ? t("runs.source.local") : t("runs.source.ci")}</td>
      <td style={s.td}>
        {run.github_url ? <MonoLink href={run.github_url}>{t("runs.viewJob")}</MonoLink> : unknown}
      </td>
    </tr>
  );
}
