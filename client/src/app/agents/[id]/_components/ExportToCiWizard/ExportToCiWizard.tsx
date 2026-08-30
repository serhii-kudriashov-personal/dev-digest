/* ExportToCiWizard — the 4-step "Export to CI" flow (SPEC-05).

   Step order is fixed by the spec: Target, Preview, Configure, Install. The
   Preview step's file list is generated from whatever triggers/publish-mode
   this component currently holds — which, on a fresh export, are still their
   defaults, because Configure comes AFTER Preview. That is a v1 property of
   the spec's own step order, not something this component works around.

   State discipline: `step`, the three form fields and the two mutations'
   OWN state are the only things stored. Whether the advance control is
   enabled, which file is the workflow, and the error text are all derived
   during render — no `useEffect` computes any of them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  ExportWizardSteps,
  FormField,
  Icon,
  MonoLink,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import type { CiExportInputBody } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useExportPreview, useInstallCi } from "@/lib/hooks/ci";
import {
  DEFAULT_BASE_BRANCH,
  GITHUB_TOKEN_SECRET_NAME,
  OPENROUTER_SECRET_NAME,
  POST_AS_OPTIONS,
  TRIGGER_EVENTS,
  type TriggerEvent,
} from "./constants";
import { findWorkflowFile, reasonFrom, toggleTrigger } from "./helpers";
import { s } from "./styles";

/** Repository, triggers and publish mode already installed for one agent —
 *  passed in when the wizard is opened as an "update" from an existing CI
 *  installation's row (AC-24). Nothing calls this yet: Dispatch 5's CI tab
 *  is the caller that will pass real pre-fill data. */
export interface ExportToCiWizardPrefill {
  repo: string;
  triggers: TriggerEvent[];
  postAs: NonNullable<CiExportInputBody["post_as"]>;
}

export interface ExportToCiWizardProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
  prefill?: ExportToCiWizardPrefill;
}

const STEP_COUNT = 4;

export function ExportToCiWizard({ agentId, agentName, onClose, prefill }: ExportToCiWizardProps) {
  const t = useTranslations("ci");
  const { activeRepo, repos } = useActiveRepo();

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(() => prefill?.repo ?? activeRepo?.full_name ?? "");
  const [triggers, setTriggers] = React.useState<TriggerEvent[]>(
    () => prefill?.triggers ?? [...TRIGGER_EVENTS],
  );
  const [postAs, setPostAs] = React.useState<NonNullable<CiExportInputBody["post_as"]>>(
    () => prefill?.postAs ?? "github_review",
  );

  const preview = useExportPreview();
  const install = useInstallCi();

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.preview"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.install"),
  ];

  // SPEC-06 — AC-47/AC-48. Which imported repository the typed name resolves
  // to, derived during render; `null` when the workspace has not imported it.
  // GitHub Actions is the only CI target, so a repository on any other forge
  // gets a STATED reason and NO action — the wizard stays reachable, the
  // continue control simply is not offered. The server refuses independently,
  // before generating or committing anything (AC-48).
  const targetRepo = repos.find((r) => r.full_name === repo.trim()) ?? null;
  const unsupportedProvider = targetRepo != null && targetRepo.provider !== "github";

  const buildInput = (): Omit<CiExportInputBody, "action"> => ({
    repo,
    // Names the instance the repository was imported from, so the server
    // resolves exactly one row when two instances hold the same path (AC-48).
    instance_id: targetRepo?.instance_id ?? null,
    triggers,
    post_as: postAs,
    base: DEFAULT_BASE_BRANCH,
  });

  const runPreview = () => preview.mutate({ agentId, input: buildInput() });

  const goNext = () => {
    if (step === 0) {
      runPreview();
    }
    setStep((n) => Math.min(n + 1, STEP_COUNT - 1));
  };

  const goBack = () => setStep((n) => Math.max(n - 1, 0));

  const canAdvanceTarget = repo.trim().length > 0 && !unsupportedProvider;
  const canAdvancePreview = !preview.isPending && preview.isSuccess;
  const busy = preview.isPending || install.isPending;

  const files = preview.data?.files ?? [];
  const workflowFile = findWorkflowFile(files);

  return (
    <div style={s.outer}>
      <div style={s.stepRail}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>

      <div style={s.body}>
        {step === 0 && (
          <div style={s.fieldGroup}>
            <div style={s.targetRow}>
              <Badge icon="Workflow" color="var(--text-primary)" bg="var(--bg-elevated)">
                {t("exportWizard.target")}
              </Badge>
              <span style={s.hint}>{t("exportWizard.targetNote")}</span>
            </div>
            <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
              <TextInput
                value={repo}
                onChange={setRepo}
                placeholder={t("exportWizard.repoPlaceholder")}
                mono
                aria-label={t("exportWizard.repoLabel")}
              />
            </FormField>
            {unsupportedProvider && (
              <div role="status" aria-live="polite" style={s.errorBox}>
                <span style={s.errorText}>
                  {t("exportWizard.unsupportedProvider", {
                    repo: targetRepo.full_name,
                    instance: targetRepo.instance_label,
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <>
            {preview.isError ? (
              <div role="alert" aria-live="assertive" style={s.errorBox}>
                <span style={s.errorText}>
                  {t("exportWizard.error.body", {
                    reason: reasonFrom(preview.error, t("exportWizard.error.unknownReason")),
                  })}
                </span>
                <div>
                  <Button kind="secondary" icon="RefreshCw" onClick={runPreview}>
                    {t("exportWizard.error.retry")}
                  </Button>
                </div>
              </div>
            ) : preview.isPending || !preview.data ? (
              <div style={s.busy} role="status" aria-live="polite">
                <Icon.RefreshCw size={16} style={{ animation: "ddspin 1s linear infinite" }} />
                <div>
                  <div>{t("exportWizard.generating")}</div>
                  <div style={s.hint}>{t("exportWizard.generatingBody")}</div>
                </div>
              </div>
            ) : (
              <div style={s.previewLayout}>
                <div style={s.fileList}>
                  <span style={s.sectionLabel}>{t("exportWizard.filesToCreate")}</span>
                  {files.map((f) => (
                    <div key={f.path} style={s.fileRow}>
                      <span className="mono" style={s.filePath}>
                        {f.path}
                      </span>
                      {f.editable && (
                        <Badge color="var(--text-muted)">{t("exportWizard.editable")}</Badge>
                      )}
                    </div>
                  ))}
                </div>
                <div style={s.workflowPane}>
                  <span style={s.sectionLabel}>{t("exportWizard.workflowPreviewTitle")}</span>
                  <pre className="mono" style={s.workflowCode}>
                    {workflowFile?.contents ?? ""}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <div style={s.fieldGroup}>
            <FormField label={t("exportWizard.triggers.label")}>
              <div style={s.triggerRow}>
                {TRIGGER_EVENTS.map((event) => (
                  <Checkbox
                    key={event}
                    checked={triggers.includes(event)}
                    onChange={() => setTriggers((cur) => toggleTrigger(cur, event))}
                    label={t(`exportWizard.triggers.${event}`)}
                  />
                ))}
              </div>
              <p style={s.hint}>{t("exportWizard.triggers.hint")}</p>
            </FormField>

            <FormField label={t("exportWizard.postResultsLabel")}>
              <SelectInput
                value={postAs}
                onChange={(v) => setPostAs(v as NonNullable<CiExportInputBody["post_as"]>)}
                options={POST_AS_OPTIONS.map((v) => ({
                  value: v,
                  label: t(
                    `exportWizard.postAs.${v === "github_review" ? "githubReview" : v === "pr_comment" ? "prComment" : "none"}`,
                  ),
                }))}
                mono={false}
              />
            </FormField>

            <div style={s.secretsBox}>
              <span style={s.sectionLabel}>{t("exportWizard.secrets.label")}</span>
              <span style={s.hint}>
                {t("exportWizard.secrets.openrouterNote", { key: OPENROUTER_SECRET_NAME })}
              </span>
              <span style={s.hint}>
                {t("exportWizard.secrets.githubTokenNote", { key: GITHUB_TOKEN_SECRET_NAME })}
              </span>
            </div>

            <div style={s.branchProtectionBox}>
              <span style={s.sectionLabel}>{t("exportWizard.branchProtection.title")}</span>
              <span style={s.hint}>{t("exportWizard.branchProtection.requiresCheck")}</span>
              <span style={s.hint}>{t("exportWizard.branchProtection.notConfigured")}</span>
            </div>
          </div>
        )}

        {step === 3 && (
          <>
            {install.isSuccess ? (
              <div style={s.confirmBox}>
                <Icon.CheckCircle size={32} style={{ color: "var(--ok)" }} />
                <div>{t("exportWizard.confirm.title")}</div>
                <div style={s.hint}>{t("exportWizard.confirm.body", { repo })}</div>
                {install.data.pr_url && (
                  <MonoLink href={install.data.pr_url}>{t("runs.viewPr")}</MonoLink>
                )}
                <Button kind="primary" onClick={onClose}>
                  {t("exportWizard.confirm.done")}
                </Button>
              </div>
            ) : install.isError ? (
              <div role="alert" aria-live="assertive" style={s.errorBox}>
                <span style={s.errorText}>
                  {t("exportWizard.error.body", {
                    reason: reasonFrom(install.error, t("exportWizard.error.unknownReason")),
                  })}
                </span>
                <div>
                  <Button
                    kind="secondary"
                    icon="RefreshCw"
                    onClick={() => install.mutate({ agentId, input: buildInput() })}
                  >
                    {t("exportWizard.error.retry")}
                  </Button>
                </div>
              </div>
            ) : (
              <div style={s.hint}>{t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}</div>
            )}
          </>
        )}
      </div>

      {!(step === 3 && install.isSuccess) && (
        <div style={s.footer}>
          <Button kind="ghost" onClick={goBack} disabled={step === 0 || busy}>
            {t("exportWizard.back")}
          </Button>
          {step < 2 && !(step === 0 && unsupportedProvider) && (
            <Button
              kind="primary"
              onClick={goNext}
              disabled={(step === 0 && !canAdvanceTarget) || (step === 1 && !canAdvancePreview)}
            >
              {t("exportWizard.continue")}
            </Button>
          )}
          {step === 2 && (
            <Button kind="primary" onClick={() => setStep(3)}>
              {t("exportWizard.continue")}
            </Button>
          )}
          {step === 3 && !install.isSuccess && (
            <Button
              kind="primary"
              loading={install.isPending}
              onClick={() => install.mutate({ agentId, input: buildInput() })}
            >
              {install.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
