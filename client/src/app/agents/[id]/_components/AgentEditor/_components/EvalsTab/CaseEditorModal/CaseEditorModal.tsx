/* CaseEditorModal — L06, SPEC-04: the split editor for one eval case. Input
   (Diff / Files / PR meta) on the left, expected output + validity + last
   result + run-on-save on the right. Opened via `?case=<id>` (A8). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Skeleton, TextInput, Textarea, Toggle, Badge, SelectInput } from "@devdigest/ui";
import type { EvalCaseRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  useCreateEvalCase,
  useDeleteEvalCase,
  useEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/eval";
import { NEW_CASE_PARAM } from "../constants";
import { filesInDiff, metaOf, tryParseJson } from "./helpers";
import { s } from "./styles";

type InputTab = "diff" | "files" | "prMeta";

export function CaseEditorModal({
  agentId,
  caseId,
  onClose,
}: {
  agentId: string;
  caseId: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const isNew = caseId === NEW_CASE_PARAM;
  const { data: existingCase, isLoading } = useEvalCase(isNew ? undefined : caseId);

  // Escape closes the modal — the Modal primitive itself has no key handling.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!isNew && isLoading) {
    return (
      <Modal title={t("caseEditor.caseTitle", { name: "…" })} onClose={onClose} width={880}>
        <div style={{ padding: 20 }}>
          <Skeleton height={240} />
        </div>
      </Modal>
    );
  }

  return (
    <CaseEditorForm
      key={existingCase?.id ?? "new"}
      agentId={agentId}
      caseId={isNew ? null : caseId}
      initial={existingCase ?? null}
      onClose={onClose}
    />
  );
}

function CaseEditorForm({
  agentId,
  caseId,
  initial,
  onClose,
}: {
  agentId: string;
  caseId: string | null;
  initial: EvalCaseRecord | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const createCase = useCreateEvalCase(agentId);
  const updateCase = useUpdateEvalCase(agentId);
  const deleteCase = useDeleteEvalCase(agentId);
  const runCase = useRunEvalCase(agentId);

  const initialMeta = metaOf(initial?.input_meta);
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [inputDiff, setInputDiff] = React.useState(initial?.input_diff ?? "");
  const [metaTitle, setMetaTitle] = React.useState(initialMeta.title ?? "");
  const [metaBody, setMetaBody] = React.useState(initialMeta.body ?? "");
  const [expectationKind, setExpectationKind] = React.useState(initial?.expectation?.kind ?? "must_find");
  const [expectFile, setExpectFile] = React.useState(initial?.expectation?.file ?? "");
  const [expectStart, setExpectStart] = React.useState(String(initial?.expectation?.start_line ?? ""));
  const [expectEnd, setExpectEnd] = React.useState(String(initial?.expectation?.end_line ?? ""));
  const [expectedOutputText, setExpectedOutputText] = React.useState(
    JSON.stringify(initial?.expected_output ?? {}, null, 2),
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [runOnSave, setRunOnSave] = React.useState(initial?.run_on_save ?? false);
  const [error, setError] = React.useState<string | null>(null);

  const parsedOutput = tryParseJson(expectedOutputText);
  const files = filesInDiff(inputDiff);

  const save = () => {
    setError(null);
    if (!parsedOutput.valid) return; // AC-13 — refused client-side too, same rule
    const start = Number(expectStart);
    const end = Number(expectEnd);
    const expectation =
      expectFile && Number.isFinite(start) && Number.isFinite(end)
        ? { kind: expectationKind as "must_find" | "must_not_flag", file: expectFile, start_line: start, end_line: end }
        : null;
    const patch = {
      name,
      input_diff: inputDiff,
      input_meta: { title: metaTitle, body: metaBody },
      expected_output: parsedOutput.value,
      notes: notes || null,
      run_on_save: runOnSave,
      expectation,
    };
    const onErr = (err: unknown) => setError(err instanceof ApiError ? err.message : t("caseEditor.saveError"));
    if (caseId) {
      updateCase.mutate({ caseId, patch }, { onError: onErr });
    } else {
      createCase.mutate(patch, { onSuccess: () => onClose(), onError: onErr });
    }
  };

  const saving = createCase.isPending || updateCase.isPending;

  return (
    <Modal
      title={t("caseEditor.caseTitle", { name: name || t("caseEditor.newCase") })}
      onClose={onClose}
      width={880}
      footer={
        <div style={s.footer}>
          <div>
            {initial && (
              <Badge color="var(--text-secondary)">
                {initial.last_result === "pass"
                  ? t("caseEditor.lastRunPassed")
                  : initial.last_result === "fail"
                    ? t("caseEditor.lastRunFailed")
                    : t("caseEditor.lastRunNever")}
              </Badge>
            )}
          </div>
          <div style={s.footerRight}>
            {caseId && (
              <>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Play"
                  loading={runCase.isPending}
                  onClick={() => runCase.mutate(caseId)}
                >
                  {t("caseEditor.runCase")}
                </Button>
                <Button
                  kind="danger"
                  size="sm"
                  icon="Trash"
                  onClick={() => {
                    deleteCase.mutate(caseId);
                    onClose();
                  }}
                >
                  {t("evalsTab.delete")}
                </Button>
              </>
            )}
            <Button kind="primary" size="sm" loading={saving} disabled={!parsedOutput.valid} onClick={save}>
              {t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.col}>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
          <div style={s.tabsRow}>
            {(["diff", "files", "prMeta"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                style={s.tabBtn(inputTab === tab)}
                onClick={() => setInputTab(tab)}
              >
                {t(`caseEditor.tabs.${tab}`)}
              </button>
            ))}
          </div>
          {inputTab === "diff" && (
            <Textarea
              value={inputDiff}
              onChange={setInputDiff}
              placeholder={t("caseEditor.diffPlaceholder")}
              rows={14}
              mono
            />
          )}
          {inputTab === "files" && (
            <div style={s.filesList}>
              {files.length === 0
                ? t("caseEditor.filesEmpty")
                : files.map((f) => <div key={f}>{f}</div>)}
            </div>
          )}
          {inputTab === "prMeta" && (
            <>
              <TextInput value={metaTitle} onChange={setMetaTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              <Textarea value={metaBody} onChange={setMetaBody} placeholder={t("caseEditor.bodyPlaceholder")} rows={6} />
            </>
          )}
          <label style={s.validityRow}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
            {t("caseEditor.runOnSave")}
          </label>
        </div>

        <div style={s.col}>
          <div style={s.validityRow}>
            <span>{t("caseEditor.expectedOutput")}</span>
            <span style={parsedOutput.valid ? s.validOk : s.validBad}>
              {parsedOutput.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </span>
          </div>
          <Textarea value={expectedOutputText} onChange={setExpectedOutputText} rows={8} mono />

          <div style={s.validityRow}>
            <span>{t("caseEditor.expectation.mustFind")} / {t("caseEditor.expectation.mustNotFlag")}</span>
          </div>
          <SelectInput
            value={expectationKind}
            onChange={(v) => setExpectationKind(v as "must_find" | "must_not_flag")}
            options={[
              { value: "must_find", label: t("caseEditor.expectation.mustFind") },
              { value: "must_not_flag", label: t("caseEditor.expectation.mustNotFlag") },
            ]}
          />
          <TextInput value={expectFile} onChange={setExpectFile} placeholder="src/config.ts" />
          <div style={{ display: "flex", gap: 8 }}>
            <TextInput value={expectStart} onChange={setExpectStart} placeholder="start line" type="number" />
            <TextInput value={expectEnd} onChange={setExpectEnd} placeholder="end line" type="number" />
          </div>
          {!initial?.expectation && initial?.needs_repair && (
            <div style={s.errorBanner}>{t("caseEditor.needsRepair")}</div>
          )}

          <Textarea value={notes} onChange={setNotes} placeholder={t("caseEditor.bodyPlaceholder")} rows={3} />

          {error && <div style={s.errorBanner}>{error}</div>}
        </div>
      </div>
    </Modal>
  );
}
