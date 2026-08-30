/* InstancesSection — Settings → Git Instances (SPEC-06 — AC-1, AC-7…AC-12).

   The interactive leaf is what carries `'use client'`; the route's `page.tsx`
   and its layout stay server components (`frontend-ui-architecture` §9).

   Three rules this screen exists to keep:
   - The credential input is WRITE-ONLY. It is cleared after a successful
     register and is never re-rendered from a response, because no response
     carries it (AC-10).
   - A test result is attributed to ONE instance by `instance_id`, so testing
     one row leaves every other row's last result exactly as it was (AC-12).
   - The approval-capability label is COMPUTED during render from
     `approval_capability`. It is never mirrored into state by an Effect
     (`react-best-practices` — "Derive, Don't Store"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, FormField, Skeleton, TextInput } from "@devdigest/ui";
import {
  useInstances,
  useRegisterInstance,
  useTestInstance,
  useDeleteInstance,
} from "@/lib/hooks/instances";
import { ApiError } from "@/lib/api";
import type { GitInstance, InstanceTestResult } from "@/lib/types";
import { SectionTitle } from "../SectionTitle";
import { CAPABILITY_KEY } from "./constants";
import { s } from "./styles";

function InstanceRow({
  instance,
  result,
  testing,
  onTest,
  onRemove,
  removing,
}: {
  instance: GitInstance;
  /** The last test result FOR THIS INSTANCE, or null — never another row's (AC-12). */
  result: InstanceTestResult | null;
  testing: boolean;
  onTest: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const t = useTranslations("settings");
  // Derived during render — no Effect, no mirrored state.
  const capability = t(CAPABILITY_KEY[instance.approval_capability]);

  return (
    <div style={s.row}>
      <div style={s.rowHead}>
        <span style={s.rowLabel}>{instance.label}</span>
        <span className="mono" style={s.rowBase}>
          {instance.base_url}
        </span>
        <div style={s.rowActions}>
          <Button kind="secondary" size="sm" onClick={onTest} disabled={testing}>
            {testing ? t("instances.testing") : t("instances.test")}
          </Button>
          <Button kind="ghost" size="sm" onClick={onRemove} disabled={removing}>
            {t("instances.remove")}
          </Button>
        </div>
      </div>
      <div style={s.meta}>
        <span>
          {instance.version
            ? t("instances.versionLabel", { version: instance.version })
            : t("instances.versionUnknown")}
        </span>
        {instance.edition && <span>{t("instances.editionLabel", { edition: instance.edition })}</span>}
        <span>
          {instance.verified_at
            ? t("instances.verifiedAt", { at: instance.verified_at })
            : t("instances.neverVerified")}
        </span>
        <span style={s.capability(instance.approval_capability)}>
          {t("instances.capability.label")}: {capability}
        </span>
      </div>
      {result && (
        <div role="status" style={s.result(result.ok)}>
          {result.ok
            ? t("instances.testOk", { instance: instance.label })
            : t("instances.testFailed", { instance: instance.label, message: result.message })}
        </div>
      )}
    </div>
  );
}

export function InstancesSection() {
  const t = useTranslations("settings");
  const { data: instances, isLoading, isError } = useInstances();
  const register = useRegisterInstance();
  const test = useTestInstance();
  const remove = useDeleteInstance();

  const [baseUrl, setBaseUrl] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [credential, setCredential] = React.useState("");
  const [registerError, setRegisterError] = React.useState<string | null>(null);
  /** Last test result per instance id. One key per row, so rows never disturb each other. */
  const [results, setResults] = React.useState<Record<string, InstanceTestResult>>({});

  const submit = async () => {
    setRegisterError(null);
    try {
      await register.mutateAsync({
        base_url: baseUrl.trim(),
        label: label.trim(),
        credential: credential.trim(),
      });
      setBaseUrl("");
      setLabel("");
      // Write-only: the token is dropped from the form and never comes back
      // from the API, so nothing can re-render it (AC-10).
      setCredential("");
    } catch (e) {
      setRegisterError(e instanceof ApiError ? e.message : t("instances.registerFailed"));
    }
  };

  const runTest = (instanceId: string) => {
    test.mutate(instanceId, {
      onSuccess: (res) => setResults((prev) => ({ ...prev, [res.instance_id]: res })),
    });
  };

  const list = instances ?? [];
  const canSubmit =
    baseUrl.trim().length > 0 && label.trim().length > 0 && credential.trim().length > 0;

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("instances.title")} body={t("instances.body")} />

      <div style={s.form}>
        <FormField label={t("instances.baseUrlLabel")} hint={t("instances.baseUrlHint")}>
          <TextInput
            value={baseUrl}
            onChange={setBaseUrl}
            mono
            placeholder={t("instances.baseUrlPlaceholder")}
            aria-label={t("instances.baseUrlLabel")}
          />
        </FormField>
        <FormField label={t("instances.labelLabel")} hint={t("instances.labelHint")}>
          <TextInput
            value={label}
            onChange={setLabel}
            placeholder={t("instances.labelPlaceholder")}
            aria-label={t("instances.labelLabel")}
          />
        </FormField>
        <FormField label={t("instances.credentialLabel")} hint={t("instances.credentialHint")}>
          <TextInput
            value={credential}
            onChange={setCredential}
            mono
            type="password"
            placeholder={t("instances.credentialPlaceholder")}
            aria-label={t("instances.credentialLabel")}
          />
        </FormField>
        <div style={s.formActions}>
          <Button
            kind="primary"
            size="md"
            onClick={submit}
            disabled={!canSubmit || register.isPending}
          >
            {register.isPending ? t("instances.registering") : t("instances.register")}
          </Button>
        </div>
        {registerError && (
          <div role="alert" style={s.error}>
            {registerError}
          </div>
        )}
      </div>

      {isLoading ? (
        <Skeleton height={64} />
      ) : isError ? (
        <EmptyState icon="AlertTriangle" title={t("instances.loadError")} body="" />
      ) : list.length === 0 ? (
        <EmptyState
          icon="GitBranch"
          title={t("instances.emptyTitle")}
          body={t("instances.emptyBody")}
        />
      ) : (
        <>
          <div style={s.count}>
            {list.length === 1
              ? t("instances.countOne")
              : t("instances.countMany", { count: list.length })}
          </div>
          {list.map((instance) => (
            <InstanceRow
              key={instance.id}
              instance={instance}
              result={results[instance.id] ?? null}
              // Derived from the mutation, not stored: `variables` is the id
              // currently in flight, so exactly one row shows a pending state.
              testing={test.isPending && test.variables === instance.id}
              removing={remove.isPending && remove.variables === instance.id}
              onTest={() => runTest(instance.id)}
              onRemove={() => {
                if (window.confirm(t("instances.removeConfirm", { label: instance.label })))
                  remove.mutate(instance.id);
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default InstancesSection;
