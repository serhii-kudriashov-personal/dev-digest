/* CreateSkillModal — author a skill from scratch: name, directive description,
   type, markdown body. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_VALUES } from "../../constants";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim(),
      description,
      type,
      source: "manual",
      body,
    });
    onCreated?.(skill);
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("drawer.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("file.nameLabel")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("file.namePlaceholder")}
            mono
          />
        </FormField>
        <FormField label={t("editor.descriptionLabel")} hint={t("editor.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("editor.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("editor.typeLabel")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("file.bodyLabel")} hint={t("editor.bodyHint")} required>
          <Textarea
            value={body}
            onChange={setBody}
            rows={10}
            mono
            placeholder={t("file.bodyPlaceholder")}
          />
        </FormField>
      </div>
    </Modal>
  );
}
