/* RootsEditor — which directories are searched for documents, per repository.

   The one editable thing on this page, and it edits DevDigest's configuration,
   not the repository: changing the roots changes where we look, never what is
   on disk.

   `editing` is owned by the parent because the "nothing matched" empty state
   opens this editor too — two components need the same flag, so it lives in
   their common parent rather than being duplicated or synced.

   The textarea keeps NO copy of the saved roots. `draft === null` means
   "untouched", and the value shown is then computed from the server's list
   during render; a `useState` seeded by an Effect on `roots` would be the same
   "store derived state, then patch it" bug this package has already paid for. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Textarea } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useSetContextRoots } from "@/lib/hooks/context";
import { ROOTS_TEXTAREA_ROWS } from "./constants";
import { parseRoots, rootsAreValid } from "./helpers";
import { s } from "./styles";

export function RootsEditor({
  repoId,
  roots,
  editing,
  onEditingChange,
}: {
  repoId: string;
  roots: string[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const t = useTranslations("context");
  const setRoots = useSetContextRoots();
  const [draft, setDraft] = React.useState<string | null>(null);

  const text = draft ?? roots.join("\n");
  const parsed = parseRoots(text);
  const valid = rootsAreValid(parsed);

  const close = () => {
    setDraft(null);
    onEditingChange(false);
  };

  const save = () => {
    if (!valid) return;
    setRoots.mutate({ repoId, roots: parsed }, { onSuccess: close });
  };

  if (!editing) {
    return (
      <div style={s.wrap}>
        <div style={s.row}>
          <span style={s.label}>{t("roots.label")}</span>
          <span className="mono" style={s.value}>
            {roots.join(", ")}
          </span>
          <Button
            kind="ghost"
            size="sm"
            icon="Settings"
            onClick={() => onEditingChange(true)}
          >
            {t("roots.edit")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <span style={s.label}>{t("roots.label")}</span>
      <Textarea
        value={text}
        onChange={setDraft}
        rows={ROOTS_TEXTAREA_ROWS}
        mono
        placeholder={t("roots.label")}
      />
      {!valid && <span style={s.error}>{t("roots.invalid")}</span>}
      {setRoots.isError && (
        <span style={s.error}>
          {setRoots.error instanceof ApiError ? setRoots.error.message : t("saveFailed")}
        </span>
      )}
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          onClick={save}
          disabled={!valid || setRoots.isPending}
        >
          {t("roots.save")}
        </Button>
        <Button kind="ghost" size="sm" onClick={close}>
          {t("roots.cancel")}
        </Button>
      </div>
    </div>
  );
}
