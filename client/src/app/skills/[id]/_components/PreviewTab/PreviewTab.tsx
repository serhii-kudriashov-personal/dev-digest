/* PreviewTab — the body rendered as markdown.

   The subtitle says "as the reviewing agent receives it", which is true of the
   CONTENT and not of the encoding: the agent receives this text inside a
   `### <slug>` block within `## Skills / rules`, as plain text, not as styled
   HTML. What this tab is for is reading the rule the way a human reads prose. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("editor.tabs.preview")}</h2>
      <p style={s.subtitle}>{t("editor.previewSubtitle")}</p>
      <div style={s.box}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
