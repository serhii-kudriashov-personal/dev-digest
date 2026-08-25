/* CiTab — the agent's Continuous Integration tab (SPEC-05).

   Renders straight from `useCiInstallations(agentId)`: no installations shows
   exactly one empty state naming the export action (AC-33); otherwise a plain
   list with a plain count — never "Active in N repos" (v1 does not
   distinguish an opened-but-unmerged setup PR from a running one). Each row's
   "Update" action opens `ExportToCiWizard` pre-filled from that row (AC-24).

   No local copy of the installations list is kept: this component holds only
   which wizard invocation (if any) is open. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci";
import { ExportToCiWizard, type ExportToCiWizardPrefill } from "../ExportToCiWizard";
import { DEFAULT_PREFILL_POST_AS, DEFAULT_PREFILL_TRIGGERS } from "./constants";
import { s } from "./styles";

export function CiTab({ agentId, agentName }: { agentId: string; agentName: string }) {
  const t = useTranslations("ci");
  const { data: installations, isLoading } = useCiInstallations(agentId);

  // Which wizard invocation is open, if any — `undefined` prefill means a
  // fresh export, a populated one means "Update" from an existing row. This
  // is the only state CiTab keeps; the installations list itself is never
  // copied out of the query cache.
  const [wizardPrefill, setWizardPrefill] = React.useState<ExportToCiWizardPrefill | undefined>();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const openExport = () => {
    setWizardPrefill(undefined);
    setWizardOpen(true);
  };
  const openUpdate = (installation: CiInstallation) => {
    setWizardPrefill({
      repo: installation.repo,
      triggers: DEFAULT_PREFILL_TRIGGERS,
      postAs: DEFAULT_PREFILL_POST_AS,
    });
    setWizardOpen(true);
  };
  const closeWizard = () => setWizardOpen(false);

  if (isLoading) return <Skeleton height={160} />;

  const list = installations ?? [];

  return (
    <div style={s.wrap}>
      {list.length > 0 && (
        <div style={s.header}>
          <div>
            <div style={s.h2}>{t("ciTab.heading")}</div>
            <p style={s.hint}>{t("ciTab.subtitle")}</p>
          </div>
          <Badge color="var(--text-secondary)">{t("ciTab.count", { count: list.length })}</Badge>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="Workflow"
          title={t("ciTab.heading")}
          body={t("ciTab.empty")}
          cta={t("ciTab.exportToCi")}
          onCta={openExport}
        />
      ) : (
        <div style={s.list}>
          {list.map((installation) => (
            <div key={installation.id} style={s.row}>
              <div style={s.rowMain}>
                <Icon.GitBranch size={14} />
                <span className="mono" style={s.repo}>
                  {installation.repo}
                </span>
                <span style={s.installed}>
                  {t("ciTab.installed", {
                    date: new Date(installation.installed_at).toLocaleDateString(),
                  })}
                </span>
              </div>
              <Button kind="secondary" size="sm" onClick={() => openUpdate(installation)}>
                {t("ciTab.update")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <Modal
          onClose={closeWizard}
          width={880}
          title={t("exportWizard.title")}
          subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
        >
          <ExportToCiWizard
            agentId={agentId}
            agentName={agentName}
            onClose={closeWizard}
            prefill={wizardPrefill}
          />
        </Modal>
      )}
    </div>
  );
}
