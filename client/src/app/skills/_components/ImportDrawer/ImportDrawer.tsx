/* ImportDrawer — bring someone else's skill into the library.

   Two deliberate steps: the file is parsed into a PREVIEW server-side, and
   nothing is stored until the user confirms. That gap is the point of the
   screen — a skill body becomes INSTRUCTIONS in an agent's prompt, so the user
   reads it, sees which archive entries were skipped, and only then saves. The
   created skill lands disabled until they vet it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Drawer,
  FormField,
  Icon,
  Markdown,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import type { Skill, SkillImportPreview, SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreateSkill, useImportSkillPreview } from "@/lib/hooks/skills";
import { SKILL_TYPE_VALUES } from "../../constants";
import { ACCEPTED_EXTENSIONS, fileToBase64 } from "./helpers";
import { s } from "./styles";

export function ImportDrawer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const preview = useImportSkillPreview();
  const create = useCreateSkill();

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [filename, setFilename] = React.useState("");
  const [parsed, setParsed] = React.useState<SkillImportPreview | null>(null);
  const [error, setError] = React.useState("");

  // Editable overrides for what the parser guessed.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setParsed(null);
    setFilename(file.name);
    try {
      const base64 = await fileToBase64(file);
      const result = await preview.mutateAsync({ filename: file.name, content_base64: base64 });
      setParsed(result);
      setName(result.name);
      setDescription(result.description);
      setType(result.type);
    } catch (e) {
      // The server's size/type refusals are the useful message here, so surface
      // them inline rather than as a generic failure.
      setError(e instanceof ApiError ? e.message : t("drawer.importFailed"));
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setError("");
    try {
      const skill = await create.mutateAsync({
        name: name.trim() || parsed.name,
        description,
        type,
        source: parsed.source,
        body: parsed.body,
        // Imported instructions start switched OFF. Enabling is the explicit act
        // of vouching for someone else's text inside your agent's prompt.
        enabled: false,
      });
      onImported?.(skill);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("drawer.importFailed"));
    }
  };

  return (
    <Drawer
      title={t("drawer.title")}
      subtitle={t("drawer.fileSubtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("drawer.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            onClick={confirm}
            disabled={!parsed || create.isPending}
          >
            {create.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.picker}>
          <Icon.Upload size={18} />
          <div style={s.pickerText}>
            {filename ? <div style={s.filename}>{filename}</div> : t("file.pickHint")}
          </div>
          <Button kind="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            {t("file.choose")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            style={s.hiddenInput}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>

        {preview.isPending && <div style={s.pickerText}>{t("file.parsing")}</div>}
        {error && <div style={s.error}>{error}</div>}

        {parsed && (
          <>
            <div style={s.notice}>{t("file.trustNotice")}</div>

            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} mono />
            </FormField>
            <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("editor.typeLabel")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
            </FormField>

            {parsed.ignored_files.length > 0 && (
              <div style={s.ignoredBox}>
                <div style={s.ignoredTitle}>
                  {t("file.ignoredTitle", { count: parsed.ignored_files.length })}
                </div>
                <ul style={s.ignoredList}>
                  {parsed.ignored_files.map((p) => (
                    <li key={p} className="mono">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <FormField
              label={t("file.extractedLabel")}
              right={<Badge color="var(--text-secondary)">{t("preview.disabled")}</Badge>}
            >
              <div style={s.ignoredBox}>
                <Markdown>{parsed.body}</Markdown>
              </div>
            </FormField>
          </>
        )}
      </div>
    </Drawer>
  );
}
