/* EvalsTab — present in the navigation, deliberately empty.

   `eval_cases.owner_kind` is already the enum `['skill','agent']` and `owner_id`
   is ready for a skill id, so the schema anticipates this — L06 (SPEC-04) built
   the eval pipeline for AGENTS only (non-goal 2); a skill-owned case set is not
   part of that spec. Saying so beats an empty grid that looks broken. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <EmptyState
      icon="ListChecks"
      title={t("evals.emptyTitle")}
      body={t("evals.emptyBody")}
    />
  );
}
