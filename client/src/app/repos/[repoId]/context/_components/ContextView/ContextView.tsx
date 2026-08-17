/* ContextView — the Project Context page for one repository.

   Read-only by design. Documents live in the repository and are discovered in
   the local mirror; the mirror is hard-reset on every sync, so anything written
   into it from here would be silently discarded after the UI said "Saved".
   There is therefore NO edit, upload, new-file or new-folder control anywhere on
   this page — the only thing editable here is WHERE we look (the search roots).

   The listing is a discriminated union on `state`, and each of the three states
   has a different remedy, so each gets its own message rather than a shared
   "empty" one:

     not_synced  there is no clone yet — wait, the query polls and the list
                 appears on its own
     no_match    there is a clone, but nothing matched — widen the roots
     ok          documents, with a summary line and a read-only preview */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { DocumentPreview } from "@/components/document-preview";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextListing, useRefreshContext } from "@/lib/hooks/context";
import { useRepos } from "@/lib/hooks/core";
import { useRepoNotFound } from "@/lib/repo-context";
import { DocumentList } from "../DocumentList";
import { RootsEditor } from "../RootsEditor";
import { joinRoots, scanAge } from "./helpers";
import { s } from "./styles";

export function ContextView() {
  const t = useTranslations("context");
  const { repoId } = useParams<{ repoId: string }>();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: repos } = useRepos();
  const repo = repos?.find((r) => r.id === repoId);

  const { data: listing, isLoading, isError, refetch } = useContextListing(repoId);
  const refresh = useRefreshContext();

  // Which document the preview shows, and whether the roots editor is open.
  // Both are UI state; neither mirrors anything the server owns.
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editingRoots, setEditingRoots] = React.useState(false);

  const crumb = [
    { label: repo?.full_name ?? t("repoFallback"), mono: true },
    { label: t("crumb") },
  ];

  // A stale or unknown :repoId is a wrong link, not a failure.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  // "not synced" carries no roots, because nothing has been scanned yet.
  const roots = listing && listing.state !== "not_synced" ? listing.roots : null;
  const age = listing?.state === "ok" ? scanAge(listing.scanned_at) : null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.h1}>{t("title")}</h1>
            {roots != null && (
              <p style={s.subtitle}>{t("subtitle", { roots: joinRoots(roots) })}</p>
            )}
          </div>
          {roots != null && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              onClick={() => refresh.mutate(repoId)}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? t("refreshing") : t("refresh")}
            </Button>
          )}
        </div>

        {roots != null && (
          <RootsEditor
            repoId={repoId}
            roots={roots}
            editing={editingRoots}
            onEditingChange={setEditingRoots}
          />
        )}

        {isLoading && <Skeleton height={220} />}

        {isError && !isLoading && (
          <ErrorState body={t("loadError")} onRetry={() => void refetch()} />
        )}

        {listing?.state === "not_synced" && (
          <EmptyState
            icon="RefreshCw"
            title={t("notSynced.title")}
            body={t("notSynced.body")}
          />
        )}

        {listing?.state === "no_match" && (
          <EmptyState
            icon="FileText"
            title={t("noMatch.title")}
            body={t("noMatch.body", { roots: joinRoots(listing.roots) })}
            cta={t("noMatch.action")}
            onCta={() => setEditingRoots(true)}
          />
        )}

        {listing?.state === "ok" && (
          <>
            <div style={s.summaryRow}>
              <span style={s.summary}>
                {t("summary", {
                  count: listing.total,
                  when: age ? t(`age.${age.unit}`, { count: age.count }) : "",
                })}
              </span>
              {listing.truncated && (
                <span style={s.truncated}>
                  {t("truncated", { cap: listing.documents.length, total: listing.total })}
                </span>
              )}
            </div>

            <div style={s.split}>
              <DocumentList
                documents={listing.documents}
                selected={selected}
                onSelect={setSelected}
              />
              <DocumentPreview repoId={repoId} path={selected} />
            </div>
          </>
        )}

        {/* Rendered in EVERY state, including when nothing matched: the answer to
            "how do I add one" is the same whether or not any exist. */}
        <p style={s.editInRepo}>{t("editInRepo")}</p>
      </div>
    </AppShell>
  );
}
