/* CreateSkillFromConventionsModal — merge the accepted conventions into one
   editable skill, then create it and attach it to an agent.

   The attach step is not a convenience. A skill reaches a review only through an
   agent that links it, so creating one without linking it produces a row nobody
   ever reads. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { BodyEditor } from "@/components/body-editor";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateSkill, useLinkAgentSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPE_VALUES } from "@/app/skills/constants";
import { MODAL_WIDTH, NO_AGENT, PREFERRED_AGENT_NAME } from "./constants";
import { s } from "./styles";

export function CreateSkillFromConventionsModal({
  draft,
  repoName,
  acceptedCount,
  onClose,
}: {
  draft: ConventionSkillDraft;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();

  const { data: agents } = useAgents();
  const create = useCreateSkill();
  const link = useLinkAgentSkill();

  // Seeded from the draft the server built. `draft` is a fresh object per open —
  // the modal is mounted only once a draft exists — so no Effect re-syncs these.
  const [name, setName] = React.useState(draft.name);
  const [description, setDescription] = React.useState(draft.description);
  const [type, setType] = React.useState<SkillType>(draft.type);
  const [enabled, setEnabled] = React.useState(draft.enabled);
  const [body, setBody] = React.useState(draft.body);
  const [agentId, setAgentId] = React.useState<string>(NO_AGENT);

  // The default target is resolved from the agents list the first time it lands.
  // Tracked with a ref rather than a dependency so a later refetch cannot
  // overwrite a choice the user has since made.
  const defaulted = React.useRef(false);
  React.useEffect(() => {
    if (defaulted.current || !agents || agents.length === 0) return;
    defaulted.current = true;
    const preferred = agents.find((a) => a.name === PREFERRED_AGENT_NAME) ?? agents[0];
    if (preferred) setAgentId(preferred.id);
  }, [agents]);

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({
    value: v,
    label: tSkills(`listItem.type.${v}`),
  }));

  const agentOptions = [
    { value: NO_AGENT, label: t("modal.attachNone") },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const pending = create.isPending || link.isPending;
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !pending;

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim(),
      description,
      type,
      source: "extracted",
      body,
      enabled,
      evidence_files: draft.evidence_files,
    });

    if (agentId === NO_AGENT) {
      toast.success(t("modal.createdUnlinkedToast"));
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
      return;
    }

    const agentName = agents?.find((a) => a.id === agentId)?.name ?? agentId;
    try {
      await link.mutateAsync({ agentId, skillId: skill.id });
      toast.success(t("modal.createdToast", { agent: agentName }));
    } catch {
      // The skill exists and is correct; only the link failed. Rolling back a
      // successful create because a follow-up failed would lose the user's work.
      toast.error(t("modal.linkFailedToast", { agent: agentName }));
    }
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={pending}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canSubmit}>
            {pending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Sparkles size={15} style={s.bannerIcon} />
          <span>{t("modal.mergedFrom", { count: acceptedCount, repo: repoName })}</span>
        </div>

        <FormField label={t("modal.nameLabel")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.twoCol}>
          <FormField label={t("modal.typeLabel")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={typeOptions}
            />
          </FormField>
          <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
            <div style={s.toggleRow}>
              <Toggle on={enabled} onChange={setEnabled} />
            </div>
          </FormField>
        </div>

        <FormField label={t("modal.attachLabel")} hint={t("modal.attachHint")}>
          <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} mono={false} />
        </FormField>

        <FormField label={t("modal.bodyLabel")} hint={t("modal.bodyHint")} required>
          <BodyEditor value={body} onChange={setBody} skillName={name} rows={14} />
        </FormField>
      </div>
    </Modal>
  );
}
