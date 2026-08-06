/* ConventionCard — one extracted house-rule: the rule, its category, the evidence
   that proves it, a confidence meter, and the accept/reject pair. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, MonoLink, ProgressBar, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { confidenceColor, copySnippet, evidenceRef } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  c,
  onAccept,
  onReject,
  onSaveRule,
  busy,
  evidenceHref,
}: {
  c: ConventionCandidate;
  onAccept: () => void;
  onReject: () => void;
  onSaveRule: (rule: string) => Promise<void>;
  busy?: boolean;
  /**
   * Where `path:line` points. Built by the caller, which is the one that knows the
   * repo — the card stays a pure renderer and needs no repo lookup of its own.
   * Absent → the reference renders as plain text rather than a dead link.
   */
  evidenceHref?: string | null;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.rule);
  const [saving, setSaving] = React.useState(false);

  const startEdit = () => {
    // Seed from the current prop at the moment editing opens, never mirror it in
    // an Effect — the prop is server state and this is a transient draft.
    setDraft(c.rule);
    setEditing(true);
  };

  const save = async () => {
    const next = draft.trim();
    if (next.length === 0 || next === c.rule) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSaveRule(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const ref = evidenceRef(c);

  return (
    <div style={s.card(c.status)}>
      <div style={s.row}>
        <div style={s.main}>
          {editing ? (
            <div style={s.editRow}>
              <FormField label={t("card.edit")}>
                <Textarea value={draft} onChange={setDraft} rows={3} />
              </FormField>
              <div style={s.editActions}>
                <Button kind="primary" size="sm" onClick={save} disabled={saving}>
                  {saving ? t("card.saving") : t("card.save")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  {t("card.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div style={s.ruleRow}>
              <div style={s.rule}>{c.rule}</div>
              <Button kind="ghost" size="sm" icon="Edit" onClick={startEdit}>
                {t("card.edit")}
              </Button>
            </div>
          )}

          <div style={s.metaRow}>
            <Badge>{t(`card.category.${c.category}`)}</Badge>
          </div>

          {ref && (
            <div style={s.evidence}>
              <div style={s.evidenceHeader}>
                {evidenceHref ? (
                  <MonoLink href={evidenceHref}>{ref}</MonoLink>
                ) : (
                  <span className="mono" style={s.evidencePath}>
                    {ref}
                  </span>
                )}
                <Icon.Copy
                  size={12}
                  style={s.copyIcon}
                  aria-label={t("card.copySnippet")}
                  onClick={() => copySnippet(c.evidence_snippet)}
                />
              </div>
              <pre className="mono" style={s.snippet}>
                {c.evidence_snippet}
              </pre>
            </div>
          )}

          <div style={s.confidenceRow}>
            <span style={s.confidenceLabel}>{t("card.confidence")}</span>
            <div style={s.confidenceBar}>
              <ProgressBar
                value={c.confidence * 100}
                height={5}
                color={confidenceColor(c.confidence)}
              />
            </div>
            <span className="mono tnum" style={s.confidenceValue}>
              {Math.round(c.confidence * 100)}%
            </span>
          </div>
        </div>

        <div style={s.actionCol}>
          <Button
            kind={c.status === "accepted" ? "primary" : "secondary"}
            size="sm"
            icon="Check"
            full
            onClick={onAccept}
            disabled={busy}
          >
            {c.status === "accepted" ? t("card.accepted") : t("card.accept")}
          </Button>
          <Button
            kind={c.status === "rejected" ? "danger" : "secondary"}
            size="sm"
            icon="X"
            full
            onClick={onReject}
            disabled={busy}
          >
            {c.status === "rejected" ? t("card.rejected") : t("card.reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
