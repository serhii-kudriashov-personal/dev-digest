/* EvalsTab — present in the navigation, deliberately empty.

   `eval_cases.owner_kind` is already the enum `['skill','agent']` and `owner_id`
   is ready for a skill id, so the schema anticipates this. But AGENTS.md reserves
   the `eval_*` tables for a later lesson, and upstream carries a separate
   `l06-evals` branch — building it here would land a second feature on tables
   another lesson owns. Saying so beats an empty grid that looks broken. */
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
