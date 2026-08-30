/* ConventionsView — scan the cloned repo for house-rules, judge each candidate,
   then merge the accepted ones into one skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionSkillDraft, ConventionStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useRepos } from "@/lib/hooks/core";
import {
  useConventionSkillDraft,
  useConventions,
  useExtractConventions,
  useSetConventionStatus,
  useUpdateConventionRule,
} from "@/lib/hooks/conventions";
import { useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { ConventionCard } from "../ConventionCard";
import { conventionEvidenceUrl, safeExternalHref } from "@/lib/forge-urls";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { acceptedIds, scanAge } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const repoNotFound = useRepoNotFound(repoId);

  const { data: repos } = useRepos();
  const repo = repos?.find((r) => r.id === repoId);
  const repoName = repo?.name ?? t("page.repoFallback");

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const setStatus = useSetConventionStatus(repoId);
  const updateRule = useUpdateConventionRule(repoId);
  const buildDraft = useConventionSkillDraft(repoId);

  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ConventionSkillDraft | null>(null);

  const candidates = data?.candidates ?? [];
  const lastScan = data?.last_scan ?? null;
  const accepted = acceptedIds(candidates);

  const runExtract = async () => {
    setError(null);
    try {
      await extract.mutateAsync(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("page.extractionFailed"));
    }
  };

  const judge = (ids: string[], status: ConventionStatus) => {
    if (ids.length === 0) return;
    setStatus.mutate({ ids, status });
  };

  const openModal = async () => {
    setError(null);
    try {
      setDraft(await buildDraft.mutateAsync(accepted));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("modal.draftFailed"));
    }
  };

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  // A stale or unknown :repoId is a wrong link, not a failure — say so instead of
  // rendering an error for a repo that was simply deleted.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const scanning = extract.isPending;
  const age = lastScan ? scanAge(lastScan.created_at) : null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            {lastScan && age ? (
              <p style={s.scanMeta}>
                {t("page.scanMeta", {
                  files: lastScan.files_sampled,
                  age: t(`page.age.${age.unit}`, { count: age.count }),
                })}
                {lastScan.dropped > 0 && t("page.scanDropped", { count: lastScan.dropped })}
              </p>
            ) : (
              <p style={s.subtitle}>{t("page.subtitle")}</p>
            )}
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={runExtract}
            disabled={scanning}
          >
            {scanning
              ? t("page.scanning")
              : candidates.length > 0
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {error && (
          <div style={s.errorWrap}>
            <ErrorState body={error} onRetry={runExtract} />
          </div>
        )}

        {isError && !isLoading && (
          <ErrorState body={t("page.loadError")} onRetry={() => void refetch()} />
        )}

        {(isLoading || (scanning && candidates.length === 0)) && (
          <div style={s.skeletonStack}>
            <Skeleton height={170} />
            <Skeleton height={170} />
          </div>
        )}

        {!isLoading && !isError && !scanning && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtract}
          />
        )}

        {candidates.length > 0 && (
          <>
            <div style={s.toolbar}>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                onClick={() => judge(accepted, "pending")}
                disabled={accepted.length === 0 || setStatus.isPending}
              >
                {t("page.deselectAll")}
              </Button>
              <span style={s.toolbarCount}>
                {t("page.acceptedCount", {
                  accepted: accepted.length,
                  total: candidates.length,
                })}
              </span>
              <div style={s.toolbarSpacer} />
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                onClick={openModal}
                disabled={accepted.length === 0 || buildDraft.isPending}
              >
                {t("page.createSkill")}
              </Button>
            </div>

            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                c={c}
                busy={setStatus.isPending}
                evidenceHref={safeExternalHref(conventionEvidenceUrl(c, repo), repo)}
                onAccept={() => judge([c.id], "accepted")}
                onReject={() => judge([c.id], "rejected")}
                onSaveRule={async (rule) => {
                  await updateRule.mutateAsync({ id: c.id, rule });
                }}
              />
            ))}
          </>
        )}
      </div>

      {draft && (
        <CreateSkillFromConventionsModal
          draft={draft}
          repoName={repoName}
          acceptedCount={accepted.length}
          onClose={() => setDraft(null)}
        />
      )}
    </AppShell>
  );
}
