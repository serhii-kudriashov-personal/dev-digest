/* ConfigTab — name, directive description, type, and the body editor.

   Uncontrolled form seeded from `skill`. There is deliberately NO Effect
   resyncing these from props: the parent renders this with `key={skill.id}`, so
   selecting a different skill remounts the component and reseeds every field for
   free. Re-adding a sync Effect here would reintroduce the "store derived state,
   then patch it" bug that client/INSIGHTS.md records as CRITICAL for ConfigTab in
   the Agent editor. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPE_VALUES } from "@/app/skills/constants";
import { BodyEditor } from "@/components/body-editor";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [versionMessage, setVersionMessage] = React.useState("");

  // Derived, not stored: whether the body differs from what the server holds.
  const bodyDirty = body !== skill.body;
  const dirty =
    bodyDirty ||
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    enabled !== skill.enabled;

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled,
          // Only meaningful when the body changed — the server ignores it
          // otherwise, since there would be no version to annotate.
          ...(bodyDirty && versionMessage.trim() ? { version_message: versionMessage.trim() } : {}),
        },
      },
      {
        onSuccess: (data) => {
          setVersionMessage("");
          toast.success(t("editor.savedToast", { version: data.version }));
        },
      },
    );

  const confirmDelete = () => {
    if (window.confirm(t("card.deleteConfirm", { name: skill.name }))) del.mutate(skill.id);
  };

  return (
    <div style={s.form}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.title")}</h2>
        <label style={s.enabledLabel}>
          {t("editor.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("file.nameLabel")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("editor.descriptionPlaceholder")}
        />
      </FormField>

      <FormField label={t("editor.typeLabel")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField label={t("file.bodyLabel")} hint={t("editor.bodyHint")} required>
        <BodyEditor value={body} onChange={setBody} skillName={name} dirty={bodyDirty} />
      </FormField>

      {/* Offered only when there is a version to annotate. */}
      {bodyDirty && (
        <FormField label={t("editor.versionMessageLabel")} hint={t("editor.versionMessageHint")}>
          <TextInput
            value={versionMessage}
            onChange={setVersionMessage}
            placeholder={t("editor.versionMessagePlaceholder")}
          />
        </FormField>
      )}

      <p style={s.severityHint}>{t("editor.severityHint")}</p>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={update.isPending || !dirty}
        >
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
        {update.isSuccess && !dirty && (
          <span style={s.savedNote}>
            {t("editor.saved", { version: update.data?.version ?? skill.version })}
          </span>
        )}
        <Button
          kind="ghost"
          icon="Trash"
          onClick={confirmDelete}
          disabled={del.isPending}
          style={s.deleteBtn}
        >
          {t("card.delete")}
        </Button>
      </div>
    </div>
  );
}
